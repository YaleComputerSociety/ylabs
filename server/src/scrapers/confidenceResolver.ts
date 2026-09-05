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
 * Deliberately makes no DB calls, so it's testable in isolation. The description
 * quality helpers below are pure, but they transitively load Mongoose models at
 * module scope, so importing this module still requires mongoose to resolve.
 */
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import {
  isDemotablePersonBio,
  isHighConfidencePersonBio,
  scoreResearchHomeDescriptionCandidate,
} from '../utils/researchHomeDescriptionSelection';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import { isPlaceholderEntityName } from '../utils/researchHomeNameIdentityAuthority';

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

const PROSE_COMPLETENESS_FIELDS = new Set(['bio', 'fullDescription', 'researchInterestSummary']);

// Curated manual overrides are meant to be authoritative until a human records a
// newer one, not to age out against scraper re-scrapes on a 90-day half-life like
// ordinary evidence. Both isManualLock sources seeded in seedSources.ts
// (manual-admin-edit and manual-pi-edit) share the same decay-reversal exposure,
// so both are exempted. A half-life this long keeps a fresher manual override
// ordered ahead of an older one (so a genuinely newer correction still wins) while
// keeping the decay contribution negligible against any scraper source's weight
// for any realistic observation age.
const NON_DECAYING_SOURCES = new Set(['manual-admin-edit', 'manual-pi-edit']);
const NON_DECAYING_SOURCE_HALF_LIFE_DAYS = 36500;

// Sources whose description prose is keyword-synthesized from directory listings
// rather than extracted from the entity's own page. For prose fields these rank
// strictly below any genuinely extracted description regardless of recency decay,
// so an authoritative lab-microsite description is never displaced by a fresher
// roster one-liner; they still win when they are the only available source.
const SYNTHESIZED_DESCRIPTION_SOURCES = new Set(['dept-faculty-roster']);
const SYNTHESIZED_SOURCE_DEMOTION_FIELDS = new Set(['fullDescription']);
const PROSE_EXTENSION_BONUS = 1.25;

// A research entity is a lab, faculty research area, or program - never a
// person - so a person biography is never a correct description for one, at any
// confidence. Without this, weight alone decides: an official profile page emits
// its bio-shaped prose at 0.55 while every synthesis lane that exists to replace
// that bio deliberately ranks below official extraction, so the replacement can
// never win and the bio is restored on the next weekly re-scrape (#2200).
// Demotion is conditional on a genuinely useful non-bio alternative existing, so
// a sole bio is still served rather than blanked in favour of a worse value.
const PERSON_BIO_DEMOTION_FIELDS = new Set(['fullDescription']);

// Scoped to the lanes written specifically to replace a served biography, rather
// than to the field alone. `isHighConfidencePersonBio` also fires on genuine
// organization prose ("Professor Jane Doe's laboratory investigates ...", or a
// center description mentioning a director's doctorate), and several sources
// emit fullDescription with no write-time bio guard, so a field-only rule
// demoted an authoritative 0.9 official description in favour of a bare 0.3
// grant abstract on labs and centers this lane never touches.
const BIO_REPLACING_DESCRIPTION_SOURCES = new Set(['fra-profile-research-synthesis']);

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

// Both predicates, because a bio-replacing lane selects its cohort on career
// facts (`isCareerBiographyDescription`) while this demotion originally keyed on
// person-voice shape. The narrower rule left the selected cohort undemotable: an
// endowed-chair or joined-the-faculty bio re-emitted weekly at 0.55 outranks the
// 0.48 replacement forever, so the lane reported success while the biography
// stayed served (#2200).
function isPersonBioProseGroup(group: { value: unknown }): boolean {
  if (typeof group.value !== 'string') return false;
  return isHighConfidencePersonBio(group.value) || isCareerBiographyDescription(group.value);
}

function hasBioReplacingSynthesisSource(group: { sources: Set<string> }): boolean {
  for (const source of group.sources) {
    if (BIO_REPLACING_DESCRIPTION_SOURCES.has(source)) return true;
  }
  return false;
}

function isUsefulProseGroup(group: { value: unknown }): boolean {
  return typeof group.value === 'string' && fullDescriptionQuality(group.value).isUseful;
}

// A curated override is a human decision about what this entity should say, so
// it is never reordered by a text heuristic. Same set as the decay exemption
// above, for the same reason: these two sources are the manual-edit lanes.
function isCuratedGroup(group: { sources: Set<string> }): boolean {
  for (const source of group.sources) {
    if (NON_DECAYING_SOURCES.has(source)) return true;
  }
  return false;
}

function isDemotableBioProseGroup(group: RankedGroup): boolean {
  return (
    typeof group.value === 'string' && !isCuratedGroup(group) && isDemotablePersonBio(group.value)
  );
}

/**
 * The bar the value that would be promoted has to clear on its own: the
 * research-home candidate score (which rejects a person-centric lead, a
 * recruiting pitch, a mission statement, and navigational copy) plus the
 * description-quality bar every other consumer applies.
 */
function isServableResearchHomeProseGroup(group: RankedGroup): boolean {
  return (
    typeof group.value === 'string' &&
    scoreResearchHomeDescriptionCandidate(group.value, 'organization') === 0 &&
    isUsefulProseGroup(group)
  );
}

function highestWeightedGroup(groups: RankedGroup[]): RankedGroup | undefined {
  return groups.reduce<RankedGroup | undefined>(
    (best, group) => (best && best.weight >= group.weight ? best : group),
    undefined,
  );
}

/**
 * Marks bio groups as demoted rather than dropping them, so they sort last but
 * stay in the ranked list. `entityMaterializer` walks that list when the winner
 * fails its own content gates, and a removed bio left the walk with nothing to
 * fall back to, blanking a description that had been served.
 *
 * Two mechanisms license the demotion. The synthesis-source rule above is one.
 * The other is research prose an ordinary source already recorded, which the
 * synthesis lane cannot supply because it skips an entity precisely when such
 * prose exists: with only the source rule, the two deadlocked and the biography
 * stayed served (#2200 follow-up).
 *
 * The over-reporting the source rule was guarding against is handled by
 * narrowing both sides rather than by naming a source. The biography must carry
 * a signal that organization prose does not produce (`isDemotablePersonBio`
 * drops the bare `Dr./Professor <Name>` opener), and the value that would be
 * promoted must clear the research-home bar on its own. Testing the value that
 * would actually be promoted, rather than counting a qualifying value anywhere
 * in the set, is what stops a bare grant abstract ranked second from being
 * promoted because a good description sat third.
 */
function demotePersonBioProseGroups(field: string, groups: RankedGroup[]): void {
  if (!PERSON_BIO_DEMOTION_FIELDS.has(field)) return;
  const bioGroups = groups.filter(isPersonBioProseGroup);
  if (bioGroups.length === 0 || bioGroups.length === groups.length) return;
  const synthesisReplacementExists = groups.some(
    (group) =>
      !isPersonBioProseGroup(group) &&
      hasBioReplacingSynthesisSource(group) &&
      isUsefulProseGroup(group),
  );
  if (synthesisReplacementExists) {
    for (const group of bioGroups) group.demoted = true;
    return;
  }
  const demotable = bioGroups.filter(isDemotableBioProseGroup);
  if (demotable.length === 0) return;
  const promoted = highestWeightedGroup(groups.filter((group) => !demotable.includes(group)));
  if (!promoted || !isServableResearchHomeProseGroup(promoted)) return;
  for (const group of demotable) group.demoted = true;
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
  // Placeholder filler is never a genuine brand, so it neither wins nor suppresses
  // the real names other sources offer. Without this a microsite "n/a" counted as
  // the brand to prefer and every roster candidate was filtered out of the ranked
  // list, leaving nothing for the materialize name repair to fall through to, so a
  // stored placeholder could only be corrected by hand (#2367).
  const micrositeGenuineExists = groups.some(
    (group) =>
      hasMicrositeSource(group) &&
      !isBarePersonName(group.value) &&
      !isFacultyResearchName(group.value) &&
      !isPlaceholderEntityName(group.value),
  );
  const isLowQualityNameGroup = (group: T): boolean => {
    if (isPlaceholderEntityName(group.value)) return true;
    if (
      micrositeGenuineExists &&
      (isSynthesizedNameGroup(group) || isFacultyResearchName(group.value))
    ) {
      return true;
    }
    return someGroupHasHeadNoun && isBarePersonName(group.value);
  };
  const genuine = groups.filter((group) => !isLowQualityNameGroup(group));
  return genuine.length > 0 ? genuine : groups;
}

interface RankedGroup {
  value: unknown;
  weight: number;
  sources: Set<string>;
  demoted?: boolean;
}

function rankFieldGroups(
  field: string,
  observations: ResolverObservation[],
  opts: ResolverOptions,
): RankedGroup[] {
  const halfLifeDays = opts.recencyHalfLifeDays ?? DEFAULTS.recencyHalfLifeDays;
  const agreementBonus = opts.agreementBonusPerExtraSource ?? DEFAULTS.agreementBonusPerExtraSource;
  const now = opts.now ?? new Date();

  const fieldObs = observations.filter((o) => o.field === field);
  if (fieldObs.length === 0) return [];

  const groups = new Map<string, RankedGroup>();
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
  demotePersonBioProseGroups(field, rankable);
  return rankable.sort(
    (a, b) => Number(a.demoted ?? false) - Number(b.demoted ?? false) || b.weight - a.weight,
  );
}

/**
 * The groups a field's winner, confidence, and conflict flag are decided from.
 * Demoted groups are fallback-only: keeping them out of this pool stops a
 * displaced person bio from diluting the winner's confidence or reporting a
 * conflict against the value that is meant to replace it.
 */
function adjudicatedGroups(ranked: RankedGroup[]): RankedGroup[] {
  const kept = ranked.filter((group) => !group.demoted);
  return kept.length > 0 ? kept : ranked;
}

export function resolveField(
  field: string,
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): ResolvedField | null {
  const conflictThreshold = opts.conflictThreshold ?? DEFAULTS.conflictThreshold;

  if (opts.manuallyLockedFields?.includes(field)) {
    return {
      value: opts.manualValues?.[field],
      confidence: 1.0,
      contributingSources: ['manual'],
      hasConflict: false,
    };
  }

  const ranked = rankFieldGroups(field, observations, opts);
  if (ranked.length === 0) return null;
  const adjudicated = adjudicatedGroups(ranked);
  const winner = adjudicated[0];
  const runnerUp = adjudicated[1];

  const totalWeight = adjudicated.reduce((acc, g) => acc + g.weight, 0);
  const confidence = totalWeight > 0 ? Math.min(1, winner.weight / totalWeight) : 0;

  let hasConflict = false;
  let conflictingValues: unknown[] | undefined;
  if (runnerUp) {
    const margin = (winner.weight - runnerUp.weight) / Math.max(winner.weight, 1e-9);
    if (margin < conflictThreshold) {
      hasConflict = true;
      conflictingValues = adjudicated.slice(0, 3).map((g) => g.value);
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

/**
 * Rank every candidate value for a field in weight-descending order, returning
 * one ResolvedField per distinct value (highest-weighted first). Consumers that
 * need to fall through past a top-ranked value rejected by a downstream content
 * gate (e.g. a fullDescription that sanitizes to empty) use this to pick the
 * next acceptable candidate rather than being stuck with the single winner.
 * Demoted values (a person bio displaced by a research description) sort last but
 * are still returned, so the walk always has a last resort.
 * A manually locked field returns only its locked value.
 */
export function resolveFieldRanked(
  field: string,
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): ResolvedField[] {
  if (opts.manuallyLockedFields?.includes(field)) {
    return [
      {
        value: opts.manualValues?.[field],
        confidence: 1.0,
        contributingSources: ['manual'],
        hasConflict: false,
      },
    ];
  }

  const ranked = rankFieldGroups(field, observations, opts);
  if (ranked.length === 0) return [];
  const totalWeight = ranked.reduce((acc, g) => acc + g.weight, 0);
  return ranked.map((g) => ({
    value: g.value,
    confidence: totalWeight > 0 ? Math.min(1, g.weight / totalWeight) : 0,
    contributingSources: Array.from(g.sources),
    hasConflict: false,
  }));
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
