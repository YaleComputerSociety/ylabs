import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
  type DescriptionQualityFlag,
} from '../utils/researchEntityDescriptionQuality';

export const THIN_SHORT_MAX_CHARS = 40;
export const THIN_FULL_MAX_CHARS = 120;
export const DEFAULT_DUPLICATE_GROUP_SIZE = 2;

export interface DescriptionEntityInput {
  id: string;
  slug?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export type FullDescriptionClass = 'empty' | 'templated-stub' | 'off-topic' | 'thin' | 'genuine';

export type ShortBackfillAction =
  | 'set-short-derived'
  | 'sanitize-short'
  | 'short-ok'
  | 'stub-no-derive'
  | 'off-topic-no-derive'
  | 'empty-full'
  | 'thin-no-derive'
  | 'no-distinct-short'
  | 'derived-equals-full';

export type DescriptionDefect =
  | 'leaked-caveat'
  | 'scrape-artifact'
  | 'templated-stub'
  | 'off-topic'
  | 'empty-full'
  | 'thin-full'
  | 'short-equals-full'
  | 'empty-short';

export interface EntityDescriptionAssessment {
  id: string;
  slug?: string;
  removedCaveat: boolean;
  removedArtifacts: boolean;
  fullClass: FullDescriptionClass;
  shortEqualsFull: boolean;
  shortAction: ShortBackfillAction;
  proposedFull: string | null;
  proposedShort: string | null;
  defects: DescriptionDefect[];
}

const OFF_TOPIC_FLAGS: DescriptionQualityFlag[] = [
  'profile-chrome',
  'appointment-only',
  'role-only',
  'recruitment-boilerplate',
  'source-news-fragment',
  'paper-fragment',
  'broken-template',
  'malformed-generated-text',
  'synthetic-placeholder',
];

const CAVEAT_PATTERNS: RegExp[] = [
  /\s*This profile-derived summary should be checked against the linked official sources before outreach\.?/gi,
  /\s*This context is synthesized from indexed Yale(?: source)? metadata and should be checked against (?:the linked official sources|official sources before outreach)\.?/gi,
];

const TEMPLATED_STUB_LEAD =
  /^(?:research (?:fields?|areas?) include\b|studies fields of interest\b|fields of interest include\b|research home (?:connected to|focused on)\b)/i;

const SYNTH_CONNECTED_TO =
  /\bis (?:an? [\w-]+ )?(?:Yale )?research home connected to\b|\b(?:Lab|Laboratory|Center|Centre|Institute|Program|Initiative|Group) is connected to\b|\bis connected to\b/i;

const RESEARCH_VERB =
  /\b(?:studies|investigates|examines|explores|focuses on|focused on|works on|develops|designs|builds|uses|employs|researches|analyzes|analyses|models|measures|conducts?|advances|combines)\b/i;

const AZ_INDEX_PATTERN = /\bA[–-]Z index\b|\blists Yale School of Medicine lab websites\b/i;

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeComparable = (value: unknown): string => normalizeText(value).toLowerCase();

const duplicateFullKey = (value: unknown): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateSample = (value: string, maxChars = 240): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;

const tidyAfterRemoval = (value: string): string =>
  value
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:]+$/g, '')
    .trim();

export interface DescriptionSanitizeResult {
  text: string;
  removedCaveat: boolean;
  removedArtifacts: boolean;
}

export function sanitizeDescriptionText(value: unknown): DescriptionSanitizeResult {
  const original = normalizeText(value);
  if (!original) return { text: '', removedCaveat: false, removedArtifacts: false };

  let text = original;
  let removedCaveat = false;
  for (const pattern of CAVEAT_PATTERNS) {
    const next = text.replace(pattern, '');
    if (next !== text) {
      removedCaveat = true;
      text = next;
    }
  }

  let removedArtifacts = false;
  const artifactSteps: Array<(input: string) => string> = [
    (input) => input.replace(/([a-z])Researcher\b/g, '$1'),
    (input) => input.replace(/\s*\bhttps?:\/\/\S+/gi, ''),
    (input) => input.replace(/\s*\bPMC\d{4,}\b/g, ''),
    (input) => input.replace(/\s*\bPMID:?\s*\d+\b/gi, ''),
    (input) =>
      input.replace(/\s*[;,]?\s*(?:\b(?:and|including)\s+)?research areas:\s*\.?\s*$/i, '.'),
  ];
  for (const step of artifactSteps) {
    const next = step(text);
    if (next !== text) {
      removedArtifacts = true;
      text = next;
    }
  }

  return { text: tidyAfterRemoval(text), removedCaveat, removedArtifacts };
}

export function isTemplatedKeywordStub(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (TEMPLATED_STUB_LEAD.test(text)) return true;
  return SYNTH_CONNECTED_TO.test(text) && !RESEARCH_VERB.test(text);
}

export function isOffTopicFullDescription(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (AZ_INDEX_PATTERN.test(text)) return true;
  return fullDescriptionQuality(text).flags.some((flag) => OFF_TOPIC_FLAGS.includes(flag));
}

export function classifyFullDescription(value: unknown): FullDescriptionClass {
  const text = normalizeText(value);
  if (!text) return 'empty';
  if (isTemplatedKeywordStub(text)) return 'templated-stub';
  if (isOffTopicFullDescription(text)) return 'off-topic';
  if (text.length < THIN_FULL_MAX_CHARS) return 'thin';
  if (fullDescriptionQuality(text).isUseful) return 'genuine';
  return 'off-topic';
}

export function assessEntityDescription(
  entity: DescriptionEntityInput,
): EntityDescriptionAssessment {
  const rawFull = normalizeText(entity.fullDescription);
  const rawShort = normalizeText(entity.shortDescription);
  const fullSanitized = sanitizeDescriptionText(entity.fullDescription);
  const shortSanitized = sanitizeDescriptionText(entity.shortDescription);

  const sanitizedFull = fullSanitized.text;
  const sanitizedShort = shortSanitized.text;
  const removedCaveat = fullSanitized.removedCaveat || shortSanitized.removedCaveat;
  const removedArtifacts = fullSanitized.removedArtifacts || shortSanitized.removedArtifacts;

  const fullClass = classifyFullDescription(sanitizedFull);
  const shortEqualsFull =
    sanitizedShort.length > 0 &&
    sanitizedFull.length > 0 &&
    normalizeComparable(sanitizedShort) === normalizeComparable(sanitizedFull);

  const shortEval = shortDescriptionQuality(sanitizedShort, sanitizedFull);
  const needsShort =
    sanitizedShort.length === 0 ||
    shortEqualsFull ||
    shortEval.flags.includes('same-as-full') ||
    shortEval.flags.includes('copied-first-sentence');

  let derivedShort = '';
  let shortAction: ShortBackfillAction;
  if (fullClass === 'empty') {
    shortAction = 'empty-full';
  } else if (fullClass === 'templated-stub') {
    shortAction = 'stub-no-derive';
  } else if (fullClass === 'off-topic') {
    shortAction = 'off-topic-no-derive';
  } else if (fullClass === 'thin') {
    shortAction = 'thin-no-derive';
  } else if (!needsShort) {
    shortAction = 'short-ok';
  } else {
    const derived = deriveShortDescriptionFromFullDescription(sanitizedFull);
    if (!derived) {
      shortAction = 'no-distinct-short';
    } else if (normalizeComparable(derived) === normalizeComparable(sanitizedShort)) {
      shortAction = 'short-ok';
    } else if (normalizeComparable(derived) === normalizeComparable(sanitizedFull)) {
      shortAction = 'derived-equals-full';
    } else {
      derivedShort = derived;
      shortAction = 'set-short-derived';
    }
  }

  const proposedFull = sanitizedFull !== rawFull ? sanitizedFull : null;
  let proposedShort: string | null = null;
  if (shortAction === 'set-short-derived') {
    proposedShort = derivedShort;
  } else if (sanitizedShort !== rawShort) {
    proposedShort = sanitizedShort;
    if (shortAction !== 'short-ok') shortAction = 'sanitize-short';
  }

  const defects: DescriptionDefect[] = [];
  if (removedCaveat) defects.push('leaked-caveat');
  if (removedArtifacts) defects.push('scrape-artifact');
  if (fullClass === 'templated-stub') defects.push('templated-stub');
  if (fullClass === 'off-topic') defects.push('off-topic');
  if (fullClass === 'empty') defects.push('empty-full');
  if (fullClass === 'thin') defects.push('thin-full');
  if (shortEqualsFull) defects.push('short-equals-full');
  if (sanitizedShort.length === 0) defects.push('empty-short');

  return {
    id: entity.id,
    slug: entity.slug,
    removedCaveat,
    removedArtifacts,
    fullClass,
    shortEqualsFull,
    shortAction,
    proposedFull,
    proposedShort,
    defects,
  };
}

export interface DescriptionDefectCounts {
  emptyShort: number;
  emptyFull: number;
  shortEqualsFull: number;
  thinShort: number;
  thinFull: number;
  leakedCaveat: number;
  scrapeArtifacts: number;
  templatedStub: number;
  offTopic: number;
  fullNotUseful: number;
}

const rawArtifactPresent = (value: string): boolean =>
  /\bhttps?:\/\//i.test(value) ||
  /\bPMC\d{4,}\b/.test(value) ||
  /\bPMID:?\s*\d+\b/i.test(value) ||
  /[a-z]Researcher\b/.test(value) ||
  /(?:\b(?:and|including)\s+)?research areas:\s*\.?\s*$/i.test(value);

interface DescriptionPair {
  shortDescription: string;
  fullDescription: string;
}

function countDefects(pairs: DescriptionPair[]): DescriptionDefectCounts {
  const counts: DescriptionDefectCounts = {
    emptyShort: 0,
    emptyFull: 0,
    shortEqualsFull: 0,
    thinShort: 0,
    thinFull: 0,
    leakedCaveat: 0,
    scrapeArtifacts: 0,
    templatedStub: 0,
    offTopic: 0,
    fullNotUseful: 0,
  };
  for (const pair of pairs) {
    const short = pair.shortDescription;
    const full = pair.fullDescription;
    if (!short) counts.emptyShort += 1;
    if (!full) counts.emptyFull += 1;
    if (short && full && normalizeComparable(short) === normalizeComparable(full)) {
      counts.shortEqualsFull += 1;
    }
    if (short && short.length < THIN_SHORT_MAX_CHARS) counts.thinShort += 1;
    if (full && full.length < THIN_FULL_MAX_CHARS) counts.thinFull += 1;
    if (
      CAVEAT_PATTERNS.some((pattern) => new RegExp(pattern.source, 'i').test(`${short} ${full}`))
    ) {
      counts.leakedCaveat += 1;
    }
    if (rawArtifactPresent(`${short} ${full}`)) counts.scrapeArtifacts += 1;
    if (isTemplatedKeywordStub(full)) counts.templatedStub += 1;
    if (full && isOffTopicFullDescription(full)) counts.offTopic += 1;
    if (full && !fullDescriptionQuality(full).isUseful) counts.fullNotUseful += 1;
  }
  return counts;
}

const emptyActionCounts = (): Record<ShortBackfillAction, number> => ({
  'set-short-derived': 0,
  'sanitize-short': 0,
  'short-ok': 0,
  'stub-no-derive': 0,
  'off-topic-no-derive': 0,
  'empty-full': 0,
  'thin-no-derive': 0,
  'no-distinct-short': 0,
  'derived-equals-full': 0,
});

export interface DescriptionBackfillSummary {
  total: number;
  before: DescriptionDefectCounts;
  after: DescriptionDefectCounts;
  actions: Record<ShortBackfillAction, number>;
  fullClass: Record<FullDescriptionClass, number>;
  writes: {
    entitiesChanged: number;
    fullSanitized: number;
    shortSanitized: number;
    shortDerived: number;
  };
  fixability: {
    backfillCleanable: number;
    needsRescrape: number;
    needsSourceOrLlm: number;
    ok: number;
  };
}

export function summarizeDescriptionBackfill(
  entities: DescriptionEntityInput[],
  assessments: EntityDescriptionAssessment[],
): DescriptionBackfillSummary {
  const beforePairs: DescriptionPair[] = entities.map((entity) => ({
    shortDescription: normalizeText(entity.shortDescription),
    fullDescription: normalizeText(entity.fullDescription),
  }));
  const afterPairs: DescriptionPair[] = entities.map((entity, index) => {
    const assessment = assessments[index];
    return {
      shortDescription:
        assessment.proposedShort ?? sanitizeDescriptionText(entity.shortDescription).text,
      fullDescription:
        assessment.proposedFull ?? sanitizeDescriptionText(entity.fullDescription).text,
    };
  });

  const actions = emptyActionCounts();
  const fullClass: Record<FullDescriptionClass, number> = {
    empty: 0,
    'templated-stub': 0,
    'off-topic': 0,
    thin: 0,
    genuine: 0,
  };
  const writes = { entitiesChanged: 0, fullSanitized: 0, shortSanitized: 0, shortDerived: 0 };
  const fixability = { backfillCleanable: 0, needsRescrape: 0, needsSourceOrLlm: 0, ok: 0 };

  for (const assessment of assessments) {
    actions[assessment.shortAction] += 1;
    fullClass[assessment.fullClass] += 1;
    if (assessment.proposedFull !== null) writes.fullSanitized += 1;
    if (assessment.proposedShort !== null) {
      if (assessment.shortAction === 'set-short-derived') writes.shortDerived += 1;
      else writes.shortSanitized += 1;
    }
    if (assessment.proposedFull !== null || assessment.proposedShort !== null) {
      writes.entitiesChanged += 1;
    }

    const backfillCleanable =
      assessment.removedCaveat ||
      assessment.removedArtifacts ||
      assessment.shortAction === 'set-short-derived';
    if (backfillCleanable) {
      fixability.backfillCleanable += 1;
    } else if (assessment.fullClass === 'templated-stub' || assessment.fullClass === 'off-topic') {
      fixability.needsSourceOrLlm += 1;
    } else if (
      assessment.fullClass === 'empty' ||
      assessment.fullClass === 'thin' ||
      assessment.shortAction === 'no-distinct-short'
    ) {
      fixability.needsRescrape += 1;
    } else {
      fixability.ok += 1;
    }
  }

  return {
    total: entities.length,
    before: countDefects(beforePairs),
    after: countDefects(afterPairs),
    actions,
    fullClass,
    writes,
    fixability,
  };
}

export interface DuplicateFullGroup {
  normalizedKey: string;
  count: number;
  slugs: string[];
  templatedStub: boolean;
  templatedFlags: DescriptionQualityFlag[];
  fullDescriptionSample: string;
}

export interface DuplicateFullReport {
  groupCount: number;
  documentCount: number;
  groups: DuplicateFullGroup[];
}

export function detectDuplicateFullGroups(
  entities: DescriptionEntityInput[],
  options: { minGroupSize?: number; maxGroups?: number; maxSlugsPerGroup?: number } = {},
): DuplicateFullReport {
  const minGroupSize = options.minGroupSize ?? DEFAULT_DUPLICATE_GROUP_SIZE;
  const maxGroups = options.maxGroups ?? 50;
  const maxSlugsPerGroup = options.maxSlugsPerGroup ?? 10;

  const buckets = new Map<string, { slugs: string[]; sample: string }>();
  for (const entity of entities) {
    const sanitizedFull = sanitizeDescriptionText(entity.fullDescription).text;
    const key = duplicateFullKey(sanitizedFull);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.slugs.push(entity.slug ?? entity.id);
    } else {
      buckets.set(key, { slugs: [entity.slug ?? entity.id], sample: sanitizedFull });
    }
  }

  const groups: DuplicateFullGroup[] = [];
  let documentCount = 0;
  for (const [normalizedKey, bucket] of buckets) {
    if (bucket.slugs.length < minGroupSize) continue;
    documentCount += bucket.slugs.length;
    groups.push({
      normalizedKey,
      count: bucket.slugs.length,
      slugs: bucket.slugs.slice(0, maxSlugsPerGroup),
      templatedStub: isTemplatedKeywordStub(bucket.sample),
      templatedFlags: fullDescriptionQuality(bucket.sample).flags,
      fullDescriptionSample: truncateSample(bucket.sample),
    });
  }

  groups.sort((a, b) => b.count - a.count || a.normalizedKey.localeCompare(b.normalizedKey));

  return { groupCount: groups.length, documentCount, groups: groups.slice(0, maxGroups) };
}
