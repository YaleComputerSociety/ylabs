/**
 * Pure-function aggregator: given a set of Observations for one (entity, field), pick a
 * winning value and compute a confidence score.
 *
 * Algorithm:
 *   1. If the field is in manuallyLockedFields on the entity, return the locked value.
 *   2. Group observations by serialized value.
 *   3. For each group: weight = sum(source.weight × recencyDecay(observedAt)).
 *   4. Apply an agreement bonus when more than one source contributes to a group.
 *   5. Return the highest-weighted group's value; flag conflict if runner-up is close.
 *
 * Deliberately pure — no DB calls — so it's testable in isolation.
 */

export interface ResolverObservation {
  field: string;
  value: unknown;
  sourceName: string;
  confidence: number;
  observedAt: Date;
}

export interface ResolvedField {
  value: unknown;
  confidence: number;
  contributingSources: string[];
  hasConflict: boolean;
  conflictingValues?: unknown[];
}

export interface ResolverOptions {
  manuallyLockedFields?: string[];
  manualValues?: Record<string, unknown>;
  recencyHalfLifeDays?: number;
  agreementBonusPerExtraSource?: number;
  conflictThreshold?: number;
  now?: Date;
}

const DEFAULTS = {
  recencyHalfLifeDays: 90,
  agreementBonusPerExtraSource: 0.1,
  conflictThreshold: 0.3,
};

const PROSE_COMPLETENESS_FIELDS = new Set([
  'bio',
  'fullDescription',
  'researchInterestSummary',
]);

// Curated admin overrides are meant to be authoritative until an admin records a
// newer one, not to age out against scraper re-scrapes on a 90-day half-life like
// ordinary evidence. A half-life this long keeps a fresher manual-admin-edit
// ordered ahead of an older one (so a genuinely newer correction still wins) while
// keeping the decay contribution negligible against any scraper source's weight
// for any realistic observation age.
const NON_DECAYING_SOURCES = new Set(['manual-admin-edit']);
const NON_DECAYING_SOURCE_HALF_LIFE_DAYS = 36500;

// Sources whose description prose is keyword-synthesized from directory listings
// rather than extracted from the entity's own page. For prose fields these rank
// strictly below any genuinely extracted description regardless of recency decay,
// so an authoritative lab-microsite description is never displaced by a fresher
// roster one-liner; they still win when they are the only available source.
const SYNTHESIZED_DESCRIPTION_SOURCES = new Set(['dept-faculty-roster']);
const SYNTHESIZED_SOURCE_DEMOTION_FIELDS = new Set(['fullDescription']);
const PROSE_EXTENSION_BONUS = 1.25;

// Name selection favors a genuinely branded name (extracted from the lab's own
// microsite or a curated directory) over a synthesized PI-derived label. These
// sources only ever emit a "<PI> Lab"/"<Person> Faculty Research" name derived
// from a grant or roster row, never the entity's self-identified brand, so for
// name fields a group sourced solely from them is demoted - but only when the
// lab's own microsite actually captured a genuine branded name to prefer, so a
// grant-shell lab with no microsite keeps its "<PI> Lab" name and a PI's
// affiliated-center name never displaces the grant name absent a microsite
// brand.
const ENTITY_NAME_FIELDS = new Set(['name', 'displayName']);
const SYNTHESIZED_NAME_SOURCES = new Set([
  'nih-reporter',
  'nsf-award-search',
  'dept-faculty-roster',
  'department-undergrad-research',
]);
// The lab's own site: authoritative for its self-identified brand.
export const MICROSITE_NAME_SOURCES = new Set([
  'lab-microsite-description-llm',
  'lab-microsite-undergrad-llm',
]);
const RESEARCH_HOME_HEAD_NOUN_RE =
  /\b(labs?|laborator(?:y|ies)|cent(?:er|re)s?|institutes?|programs?|programmes?|initiatives?|groups?|projects?|collaboratives?|consorti(?:um|a)|networks?|clinics?|cores?|facilit(?:y|ies)|observator(?:y|ies)|studios?|workshops?)\b/i;
const FACULTY_RESEARCH_NAME_RE = /\bfaculty\s+research\s*$/i;

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  if (Array.isArray(value)) {
    const sorted = [...value].map((v) => serializeValue(v)).sort();
    return `a:[${sorted.join(',')}]`;
  }
  if (typeof value === 'object') {
    return `o:${JSON.stringify(value, Object.keys(value as object).sort())}`;
  }
  return `x:${String(value)}`;
}

function recencyDecay(observedAt: Date, now: Date, halfLifeDays: number): number {
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function halfLifeDaysForSource(sourceName: string, defaultHalfLifeDays: number): number {
  return NON_DECAYING_SOURCES.has(sourceName)
    ? NON_DECAYING_SOURCE_HALF_LIFE_DAYS
    : defaultHalfLifeDays;
}

function normalizedProse(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sourcesOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const source of a) {
    if (b.has(source)) return true;
  }
  return false;
}

function applyProseCompletenessBonus(
  field: string,
  groups: Iterable<{ value: unknown; weight: number; sources: Set<string> }>,
) {
  if (!PROSE_COMPLETENESS_FIELDS.has(field)) return;
  const proseGroups = Array.from(groups).filter(
    (group) => typeof group.value === 'string' && normalizedProse(group.value).length >= 80,
  );

  for (const candidate of proseGroups) {
    const candidateText = normalizedProse(candidate.value);
    const extendsAnotherValue = proseGroups.some((other) => {
      if (candidate === other || !sourcesOverlap(candidate.sources, other.sources)) return false;
      const otherText = normalizedProse(other.value);
      return (
        candidateText.length >= otherText.length * 1.35 &&
        otherText.length >= 80 &&
        otherText.length < 160 &&
        candidateText.startsWith(otherText)
      );
    });

    if (extendsAnotherValue) {
      candidate.weight *= PROSE_EXTENSION_BONUS;
    }
  }
}

function isSynthesizedProseGroup(group: { sources: Set<string> }): boolean {
  if (group.sources.size === 0) return false;
  for (const source of group.sources) {
    if (!SYNTHESIZED_DESCRIPTION_SOURCES.has(source)) return false;
  }
  return true;
}

function preferExtractedProseGroups<T extends { sources: Set<string> }>(
  field: string,
  groups: T[],
): T[] {
  if (!SYNTHESIZED_SOURCE_DEMOTION_FIELDS.has(field)) return groups;
  const extracted = groups.filter((group) => !isSynthesizedProseGroup(group));
  return extracted.length > 0 ? extracted : groups;
}

function nameHasResearchHomeHeadNoun(value: unknown): boolean {
  return typeof value === 'string' && RESEARCH_HOME_HEAD_NOUN_RE.test(value);
}

function isBarePersonName(value: unknown): boolean {
  if (typeof value !== 'string' || nameHasResearchHomeHeadNoun(value)) return false;
  const tokens = value
    .trim()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every((token) => /^[A-Z][a-zA-Z'.-]*$/.test(token));
}

function isSynthesizedNameGroup(group: { sources: Set<string> }): boolean {
  if (group.sources.size === 0) return false;
  for (const source of group.sources) {
    if (!SYNTHESIZED_NAME_SOURCES.has(source)) return false;
  }
  return true;
}

function isFacultyResearchName(value: unknown): boolean {
  return typeof value === 'string' && FACULTY_RESEARCH_NAME_RE.test(value);
}

function hasMicrositeSource(group: { sources: Set<string> }): boolean {
  for (const source of group.sources) {
    if (MICROSITE_NAME_SOURCES.has(source)) return true;
  }
  return false;
}

function preferGenuineEntityNameGroups<T extends { value: unknown; sources: Set<string> }>(
  field: string,
  groups: T[],
): T[] {
  if (!ENTITY_NAME_FIELDS.has(field)) return groups;
  const someGroupHasHeadNoun = groups.some((group) => nameHasResearchHomeHeadNoun(group.value));
  // Synthesized/faculty-research labels are demoted only when the lab's own
  // microsite captured a genuine branded name to prefer instead; without one,
  // a "<PI> Lab" grant name is kept and a non-microsite affiliation name never
  // wins by default. A bare person name is never a good entity name, so it is
  // demoted whenever a head-noun alternative exists, regardless of source.
  const micrositeGenuineExists = groups.some(
    (group) =>
      hasMicrositeSource(group) &&
      !isBarePersonName(group.value) &&
      !isFacultyResearchName(group.value),
  );
  const isLowQualityNameGroup = (group: T): boolean => {
    if (micrositeGenuineExists && (isSynthesizedNameGroup(group) || isFacultyResearchName(group.value))) {
      return true;
    }
    return someGroupHasHeadNoun && isBarePersonName(group.value);
  };
  const genuine = groups.filter((group) => !isLowQualityNameGroup(group));
  return genuine.length > 0 ? genuine : groups;
}

export function resolveField(
  field: string,
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): ResolvedField | null {
  const halfLifeDays = opts.recencyHalfLifeDays ?? DEFAULTS.recencyHalfLifeDays;
  const agreementBonus = opts.agreementBonusPerExtraSource ?? DEFAULTS.agreementBonusPerExtraSource;
  const conflictThreshold = opts.conflictThreshold ?? DEFAULTS.conflictThreshold;
  const now = opts.now ?? new Date();

  if (opts.manuallyLockedFields?.includes(field)) {
    return {
      value: opts.manualValues?.[field],
      confidence: 1.0,
      contributingSources: ['manual'],
      hasConflict: false,
    };
  }

  const fieldObs = observations.filter((o) => o.field === field);
  if (fieldObs.length === 0) return null;

  const groups = new Map<
    string,
    { value: unknown; weight: number; sources: Set<string> }
  >();
  for (const obs of fieldObs) {
    const key = serializeValue(obs.value);
    const decay = recencyDecay(
      obs.observedAt,
      now,
      halfLifeDaysForSource(obs.sourceName, halfLifeDays),
    );
    const contribution = obs.confidence * decay;
    let g = groups.get(key);
    if (!g) {
      g = { value: obs.value, weight: 0, sources: new Set() };
      groups.set(key, g);
    }
    g.weight += contribution;
    g.sources.add(obs.sourceName);
  }

  for (const g of groups.values()) {
    if (g.sources.size > 1) {
      g.weight *= 1 + agreementBonus * (g.sources.size - 1);
    }
  }
  applyProseCompletenessBonus(field, groups.values());

  const rankable = preferGenuineEntityNameGroups(
    field,
    preferExtractedProseGroups(field, Array.from(groups.values())),
  );
  const ranked = rankable.sort((a, b) => b.weight - a.weight);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  const totalWeight = ranked.reduce((acc, g) => acc + g.weight, 0);
  const confidence = totalWeight > 0 ? Math.min(1, winner.weight / totalWeight) : 0;

  let hasConflict = false;
  let conflictingValues: unknown[] | undefined;
  if (runnerUp) {
    const margin = (winner.weight - runnerUp.weight) / Math.max(winner.weight, 1e-9);
    if (margin < conflictThreshold) {
      hasConflict = true;
      conflictingValues = ranked.slice(0, 3).map((g) => g.value);
    }
  }

  return {
    value: winner.value,
    confidence,
    contributingSources: Array.from(winner.sources),
    hasConflict,
    conflictingValues,
  };
}

export function resolveAllFields(
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): Record<string, ResolvedField> {
  const fields = new Set(observations.map((o) => o.field));
  if (opts.manuallyLockedFields) {
    for (const f of opts.manuallyLockedFields) fields.add(f);
  }
  const out: Record<string, ResolvedField> = {};
  for (const field of fields) {
    const resolved = resolveField(field, observations, opts);
    if (resolved) out[field] = resolved;
  }
  return out;
}
