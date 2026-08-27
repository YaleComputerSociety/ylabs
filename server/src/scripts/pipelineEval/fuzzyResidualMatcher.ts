import {
  compareEntities,
  cosine,
  firstNameCompatibility,
  metaphone,
  normalizeToken,
  tokenize,
  type ComparableEntity,
  type EntityFeatureVector,
} from './fuzzyMatchFeatures';
import { pairKey } from './fuzzyMatchMetrics';

export interface MatcherEntity extends ComparableEntity {
  id: string;
  entityType?: string;
}

export interface CandidateGenerationOptions {
  maxBlockSize?: number;
  maxPerEntity?: number;
  annThreshold?: number;
  annTopK?: number;
  excludePairs?: Set<string>;
}

const DEFAULT_MAX_BLOCK_SIZE = 40;
const DEFAULT_MAX_PER_ENTITY = 50;
const DEFAULT_ANN_THRESHOLD = 0.85;
const DEFAULT_ANN_TOP_K = 20;

const ORG_STOPWORDS = new Set([
  'lab',
  'laboratory',
  'labs',
  'center',
  'centre',
  'institute',
  'initiative',
  'program',
  'programme',
  'group',
  'the',
  'for',
  'of',
  'and',
  'in',
  'at',
  'research',
  'yale',
  'university',
]);

const UMBRELLA_HOSTS = new Set(['yale.edu', 'www.yale.edu']);

const ORG_LIKE_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE']);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export function hostOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = value.includes('://') ? value : `https://${value}`;
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isDistinctiveHost(host: string): boolean {
  return host !== '' && !UMBRELLA_HOSTS.has(host);
}

function surnameOf(entity: MatcherEntity): string {
  const explicit = typeof entity.surname === 'string' ? entity.surname : '';
  if (explicit) return explicit;
  const name = typeof entity.name === 'string' ? entity.name : '';
  return tokenize(name).slice(-1)[0] ?? '';
}

function significantOrgTokens(entity: MatcherEntity): string[] {
  const name = typeof entity.name === 'string' ? entity.name : '';
  return tokenize(name).filter((token) => token.length >= 3 && !ORG_STOPWORDS.has(token));
}

function addBlock(keyToIds: Map<string, string[]>, key: string, id: string): void {
  const arr = keyToIds.get(key) ?? [];
  arr.push(id);
  keyToIds.set(key, arr);
}

export function generateCandidatePairs(
  entities: MatcherEntity[],
  options: CandidateGenerationOptions = {},
): Set<string> {
  const maxBlockSize = options.maxBlockSize ?? DEFAULT_MAX_BLOCK_SIZE;
  const maxPerEntity = options.maxPerEntity ?? DEFAULT_MAX_PER_ENTITY;
  const annThreshold = options.annThreshold ?? DEFAULT_ANN_THRESHOLD;
  const annTopK = options.annTopK ?? DEFAULT_ANN_TOP_K;
  const exclude = options.excludePairs ?? new Set<string>();

  const keyToIds = new Map<string, string[]>();
  for (const entity of entities) {
    const surnameCode = metaphone(surnameOf(entity));
    if (surnameCode) addBlock(keyToIds, `surname:${surnameCode}`, entity.id);
    for (const token of significantOrgTokens(entity)) addBlock(keyToIds, `org:${token}`, entity.id);
    if (Array.isArray(entity.departments)) {
      for (const dept of entity.departments) {
        if (typeof dept === 'string') addBlock(keyToIds, `dept:${normalizeToken(dept)}`, entity.id);
      }
    }
    if (Array.isArray(entity.researchAreas)) {
      for (const area of entity.researchAreas) {
        if (typeof area === 'string') addBlock(keyToIds, `area:${normalizeToken(area)}`, entity.id);
      }
    }
  }

  const perEntityCount = new Map<string, number>();
  const pairs = new Set<string>();
  const tryAdd = (a: string, b: string): void => {
    if (a === b) return;
    const key = pairKey(a, b);
    if (pairs.has(key) || exclude.has(key)) return;
    if (
      (perEntityCount.get(a) ?? 0) >= maxPerEntity ||
      (perEntityCount.get(b) ?? 0) >= maxPerEntity
    )
      return;
    pairs.add(key);
    perEntityCount.set(a, (perEntityCount.get(a) ?? 0) + 1);
    perEntityCount.set(b, (perEntityCount.get(b) ?? 0) + 1);
  };

  for (const ids of keyToIds.values()) {
    if (ids.length < 2 || ids.length > maxBlockSize) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) tryAdd(ids[i], ids[j]);
    }
  }

  const embedded = entities.filter(
    (e): e is MatcherEntity & { embedding: number[] } =>
      Array.isArray(e.embedding) && e.embedding.length > 0,
  );
  for (const a of embedded) {
    const neighbors: Array<{ id: string; score: number }> = [];
    for (const b of embedded) {
      if (a.id === b.id) continue;
      const score = cosine(a.embedding, b.embedding);
      if (score >= annThreshold) neighbors.push({ id: b.id, score });
    }
    neighbors.sort((x, y) => y.score - x.score);
    for (const neighbor of neighbors.slice(0, annTopK)) tryAdd(a.id, neighbor.id);
  }

  return pairs;
}

export interface FeatureWeight {
  m: number;
  u: number;
}

// Fellegi-Sunter default m (agreement prob | true match) and u (agreement prob |
// non-match) per feature. These are untrained priors, not learned from data; a
// later PR can estimate m via EM and u by random sampling. Each agreeing feature
// contributes log2(m/u); a disagreeing one contributes log2((1-m)/(1-u)).
export const DEFAULT_FEATURE_WEIGHTS: Record<string, FeatureWeight> = {
  surnameMetaphone: { m: 0.95, u: 0.05 },
  nameJaroWinkler: { m: 0.9, u: 0.02 },
  nameTokenSet: { m: 0.85, u: 0.05 },
  department: { m: 0.6, u: 0.1 },
  researchArea: { m: 0.6, u: 0.15 },
  host: { m: 0.7, u: 0.005 },
  embedding: { m: 0.8, u: 0.05 },
  pi: { m: 0.9, u: 0.002 },
};

const DEFAULT_LAMBDA = 0.02;

export type MatchBand = 'auto' | 'review' | 'discard';

export interface PairScore {
  score: number;
  band: MatchBand;
  vetoed: boolean;
  vetoReason?: string;
  features: EntityFeatureVector;
}

export interface ScoreOptions {
  weights?: Record<string, FeatureWeight>;
  lambda?: number;
  tUpper?: number;
  tLower?: number;
}

const DEFAULT_T_UPPER = 0.9;
const DEFAULT_T_LOWER = 0.5;

function orgLike(entityType?: string): boolean {
  return typeof entityType === 'string' && ORG_LIKE_ENTITY_TYPES.has(entityType);
}

function vetoReasonFor(a: MatcherEntity, b: MatcherEntity): string | undefined {
  // Use the EXPLICIT first-name fields, not features.firstNameCompatibility, which
  // compareEntities derives with a full-name fallback: for a bare "<Surname> Lab"
  // that makes the surname look like a conflicting given name. An absent first name
  // must not veto.
  if (firstNameCompatibility(a.firstName, b.firstName) === 'conflicting')
    return 'first_name_conflict';
  if (
    a.entityType &&
    b.entityType &&
    a.entityType !== b.entityType &&
    orgLike(a.entityType) !== orgLike(b.entityType)
  ) {
    return 'entity_type_incompatible';
  }
  return undefined;
}

function log2(value: number): number {
  return Math.log(value) / Math.log(2);
}

export function scorePair(
  a: MatcherEntity,
  b: MatcherEntity,
  options: ScoreOptions = {},
): PairScore {
  const weights = options.weights ?? DEFAULT_FEATURE_WEIGHTS;
  const lambda = options.lambda ?? DEFAULT_LAMBDA;
  const tUpper = options.tUpper ?? DEFAULT_T_UPPER;
  const tLower = options.tLower ?? DEFAULT_T_LOWER;

  const features = compareEntities(a, b);
  const veto = vetoReasonFor(a, b);
  if (veto) {
    return { score: 0, band: 'discard', vetoed: true, vetoReason: veto, features };
  }

  const hostA = hostOf(a.websiteUrl);
  const hostB = hostOf(b.websiteUrl);
  const distinctiveHostMatch =
    isDistinctiveHost(hostA) && isDistinctiveHost(hostB) && hostA === hostB;
  const hasItems = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

  // A feature contributes its Fellegi-Sunter weight only when it is COMPARABLE
  // (both sides carry the data). An absent feature is neutral (0), never a
  // disagreement penalty - otherwise a strong shared-PI match with sparse other
  // fields would be buried by penalties for merely-missing attributes.
  const features3: Array<[keyof typeof DEFAULT_FEATURE_WEIGHTS, boolean, boolean]> = [
    [
      'surnameMetaphone',
      metaphone(surnameOf(a)) !== '' && metaphone(surnameOf(b)) !== '',
      features.surnameMetaphoneMatch,
    ],
    [
      'nameJaroWinkler',
      asString(a.name) !== '' && asString(b.name) !== '',
      features.nameJaroWinkler >= 0.9,
    ],
    [
      'nameTokenSet',
      asString(a.name) !== '' && asString(b.name) !== '',
      features.nameTokenSetRatio >= 0.8,
    ],
    [
      'department',
      hasItems(a.departments) && hasItems(b.departments),
      features.departmentJaccard > 0,
    ],
    [
      'researchArea',
      hasItems(a.researchAreas) && hasItems(b.researchAreas),
      features.researchAreaJaccard >= 0.2,
    ],
    ['host', isDistinctiveHost(hostA) && isDistinctiveHost(hostB), distinctiveHostMatch],
    ['embedding', hasItems(a.embedding) && hasItems(b.embedding), features.embeddingCosine >= 0.85],
    ['pi', hasItems(a.pi) && hasItems(b.pi), features.piOverlap > 0],
  ];

  let total = log2(lambda / (1 - lambda));
  for (const [name, comparable, agrees] of features3) {
    if (!comparable) continue;
    const weight = weights[name];
    if (!weight) continue;
    total += agrees ? log2(weight.m / weight.u) : log2((1 - weight.m) / (1 - weight.u));
  }

  const odds = Math.pow(2, total);
  const score = odds / (1 + odds);
  const band: MatchBand = score >= tUpper ? 'auto' : score >= tLower ? 'review' : 'discard';
  return { score, band, vetoed: false, features };
}

export interface FuzzyResidualPlanEntry {
  pair: [string, string];
  score: number;
  band: MatchBand;
  features: EntityFeatureVector;
}

export interface FuzzyResidualPlanOptions extends CandidateGenerationOptions, ScoreOptions {}

export function buildFuzzyResidualPlan(
  entities: MatcherEntity[],
  options: FuzzyResidualPlanOptions = {},
): { plan: FuzzyResidualPlanEntry[]; candidatePairs: Set<string> } {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const candidatePairs = generateCandidatePairs(entities, options);
  const plan: FuzzyResidualPlanEntry[] = [];
  for (const key of candidatePairs) {
    const [idA, idB] = key.split('|');
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (!a || !b) continue;
    const scored = scorePair(a, b, options);
    if (scored.band === 'discard') continue;
    plan.push({
      pair: [idA, idB],
      score: scored.score,
      band: scored.band,
      features: scored.features,
    });
  }
  plan.sort((x, y) => y.score - x.score);
  return { plan, candidatePairs };
}
