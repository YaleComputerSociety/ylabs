import { phase0ResearchSearchSettingsFingerprint } from './phase0ResearchSearchBaselineCore';

export type ResearchSearchQueryClass =
  | 'topic'
  | 'short-alias'
  | 'method'
  | 'semantic-phrase'
  | 'person-name';

export interface ResearchSearchRelevanceCase {
  label: string;
  queryClass: ResearchSearchQueryClass;
  query: string;
  relevanceMarkers: readonly string[];
}

export type ResearchSearchPerturbationKind =
  | 'transposition'
  | 'deletion'
  | 'doubling'
  | 'substitution'
  | 'casing';

export const RESEARCH_SEARCH_PERTURBATION_KINDS: readonly ResearchSearchPerturbationKind[] = [
  'transposition',
  'deletion',
  'doubling',
  'substitution',
  'casing',
] as const;

// Meilisearch grants no typo tolerance below `minWordSizeForTypos.oneTypo`, which
// `researchEntitySearchIndexService` leaves at the default 5. Perturbing a shorter
// token would score a guaranteed miss that measures the configured policy rather
// than a defect, so those cases are skipped and counted instead of failed.
export const MIN_PERTURBABLE_TOKEN_LENGTH = 5;

const KEYBOARD_NEIGHBOURS: Record<string, string> = {
  a: 's',
  b: 'v',
  c: 'x',
  d: 'f',
  e: 'r',
  f: 'g',
  g: 'h',
  h: 'j',
  i: 'o',
  j: 'k',
  k: 'l',
  l: 'k',
  m: 'n',
  n: 'm',
  o: 'p',
  p: 'o',
  q: 'w',
  r: 't',
  s: 'd',
  t: 'y',
  u: 'i',
  v: 'b',
  w: 'e',
  x: 'z',
  y: 'u',
  z: 'x',
};

export interface ResearchSearchPerturbation {
  kind: ResearchSearchPerturbationKind;
  query: string;
}

export interface SkippedResearchSearchPerturbation {
  kind: ResearchSearchPerturbationKind;
  skippedReason: 'no-perturbable-token' | 'perturbation-is-identity';
}

const tokenizeForPerturbation = (query: string): string[] => query.split(/(\s+)/);

const longestPerturbableTokenIndex = (parts: string[]): number => {
  let bestIndex = -1;
  let bestLength = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (/^\s*$/.test(part)) continue;
    if (!/^[a-z]+$/i.test(part)) continue;
    if (part.length > bestLength) {
      bestIndex = index;
      bestLength = part.length;
    }
  }
  return bestLength >= MIN_PERTURBABLE_TOKEN_LENGTH ? bestIndex : -1;
};

const perturbToken = (token: string, kind: ResearchSearchPerturbationKind): string => {
  const pivot = Math.floor(token.length / 2);
  switch (kind) {
    case 'transposition':
      return `${token.slice(0, pivot - 1)}${token[pivot]}${token[pivot - 1]}${token.slice(pivot + 1)}`;
    case 'deletion':
      return `${token.slice(0, pivot)}${token.slice(pivot + 1)}`;
    case 'doubling':
      return `${token.slice(0, pivot)}${token[pivot]}${token.slice(pivot)}`;
    case 'substitution': {
      const target = token[pivot];
      const replacement = KEYBOARD_NEIGHBOURS[target.toLowerCase()] || target;
      const cased = target === target.toUpperCase() ? replacement.toUpperCase() : replacement;
      return `${token.slice(0, pivot)}${cased}${token.slice(pivot + 1)}`;
    }
    case 'casing':
      return token.toUpperCase();
    default:
      return token;
  }
};

export function perturbResearchSearchQuery(
  query: string,
  kind: ResearchSearchPerturbationKind,
): ResearchSearchPerturbation | SkippedResearchSearchPerturbation {
  const parts = tokenizeForPerturbation(query);
  const targetIndex = longestPerturbableTokenIndex(parts);
  if (targetIndex < 0) {
    return { kind, skippedReason: 'no-perturbable-token' };
  }

  const perturbed = [...parts];
  perturbed[targetIndex] = perturbToken(parts[targetIndex], kind);
  const perturbedQuery = perturbed.join('');
  if (perturbedQuery === query) {
    return { kind, skippedReason: 'perturbation-is-identity' };
  }
  return { kind, query: perturbedQuery };
}

export const isSkippedResearchSearchPerturbation = (
  value: ResearchSearchPerturbation | SkippedResearchSearchPerturbation,
): value is SkippedResearchSearchPerturbation => 'skippedReason' in value;

// The marker oracle has to read the same text Meilisearch matched on, so these are
// the topical `searchableAttributes` of the ResearchEntity index rather than the
// fields the list DTO serves: `forList` trims `fullDescription`, and
// `orgAffiliationLabels`, `studentSearchTerms`, `leadProfessorNames` and
// `professorNames` never reach a DTO at all. Judging a hit on the served card
// would score a correct match irrelevant whenever its evidence lives in one of
// those, so the CLI resolves each hit back to its index document.
export const RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS = [
  'name',
  'displayName',
  'leadProfessorNames',
  'professorNames',
  'departments',
  'researchAreas',
  'methods',
  'shortDescription',
  'fullDescription',
  'orgAffiliationLabels',
  'studentSearchTerms',
] as const;

const flattenFieldText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenFieldText).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(flattenFieldText)
      .join(' ');
  }
  return '';
};

export function researchSearchRelevanceText(entity: Record<string, unknown>): string {
  const parts = RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS.map((field) =>
    flattenFieldText(entity[field]),
  );
  parts.push(flattenFieldText(entity.cardDescription));
  return parts.join(' ').toLowerCase();
}

// A marker hit is a lexical proxy for topical relevance, not a relevance oracle:
// it detects gross retrieval failure (a page of rows with nothing to do with the
// query) and it cannot judge ordering quality among rows that all match. Read the
// numbers as a regression detector, and do not tune ranking to maximize them.
export function relevanceTextMatchesMarkers(text: string, markers: readonly string[]): boolean {
  if (markers.length === 0) return false;
  return markers.some((marker) => text.includes(marker.toLowerCase()));
}

export function matchesRelevanceMarkers(
  entity: Record<string, unknown>,
  markers: readonly string[],
): boolean {
  return relevanceTextMatchesMarkers(researchSearchRelevanceText(entity), markers);
}

export function precisionAtDepth(relevanceFlags: readonly boolean[], depth: number): number {
  if (depth <= 0) return 0;
  const considered = relevanceFlags.slice(0, depth);
  if (considered.length === 0) return 0;
  return considered.filter(Boolean).length / considered.length;
}

export function reciprocalRank(relevanceFlags: readonly boolean[]): number {
  const firstRelevant = relevanceFlags.findIndex(Boolean);
  return firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1);
}

// Average overlap at depth k: the mean, over every prefix depth 1..k, of the
// fraction of shared ids. This is the p->1 limit of rank-biased overlap, chosen
// over RBO itself because it needs no persistence parameter and no tail
// extrapolation, so a reported number cannot be argued with by retuning `p`.
//
// Averaging stops at the longer of the two lists rather than at the requested
// depth. Normalizing by the requested depth instead would score two identical
// short result sets far below 1 - two identical ids at --top-k 10 reported 0.486,
// under the default 0.5 threshold, so a query returning few rows raised a
// typo-collapse finding for perfect typo robustness. A short *perturbed* list is
// still penalized, because the longer baseline sets the averaging depth.
export function averageOverlapAtDepth(
  left: readonly string[],
  right: readonly string[],
  depth: number,
): number {
  if (depth <= 0) return 0;
  const effectiveDepth = Math.min(depth, Math.max(left.length, right.length));
  if (effectiveDepth === 0) return 1;
  const leftSeen = new Set<string>();
  const rightSeen = new Set<string>();
  let shared = 0;
  let overlapSum = 0;
  for (let index = 0; index < effectiveDepth; index += 1) {
    const leftId = left[index];
    const rightId = right[index];
    if (leftId !== undefined && !leftSeen.has(leftId)) {
      leftSeen.add(leftId);
      if (rightSeen.has(leftId)) shared += 1;
    }
    if (rightId !== undefined && !rightSeen.has(rightId)) {
      rightSeen.add(rightId);
      if (leftSeen.has(rightId)) shared += 1;
    }
    overlapSum += shared / (index + 1);
  }
  return overlapSum / effectiveDepth;
}

export function jaccardAtDepth(
  left: readonly string[],
  right: readonly string[],
  depth: number,
): number {
  const leftSet = new Set(left.slice(0, depth));
  const rightSet = new Set(right.slice(0, depth));
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  let intersection = 0;
  for (const id of leftSet) {
    if (rightSet.has(id)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export interface ResearchSearchProbeOutcome {
  resultIds: string[];
  relevanceFlags: boolean[];
  unresolvedIndexDocuments?: number;
  estimatedTotalHits: number;
  degraded: boolean;
  latencyMs: number;
}

export interface ResearchSearchPerturbationResult {
  kind: ResearchSearchPerturbationKind;
  skippedReason?: SkippedResearchSearchPerturbation['skippedReason'];
  perturbedQuery?: string;
  resultCount?: number;
  estimatedTotalHits?: number;
  degraded?: boolean;
  averageOverlap?: number;
  jaccard?: number;
  topRankPreserved?: boolean;
  precisionAtK?: number;
}

export interface ResearchSearchRelevanceCaseResult {
  label: string;
  queryClass: ResearchSearchQueryClass;
  query?: string;
  queryShape?: string;
  topK: number;
  resultCount: number;
  estimatedTotalHits: number;
  degraded: boolean;
  latencyMs: number;
  precisionAtK: number;
  reciprocalRank: number;
  perturbations: ResearchSearchPerturbationResult[];
}

const roundedRatio = (value: number): number => Math.round(value * 1000) / 1000;

export function researchSearchQueryShape(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token) => `token(len=${token.length})`).join(' ');
}

export function summarizeResearchSearchRelevanceCase(input: {
  searchCase: ResearchSearchRelevanceCase;
  topK: number;
  baseline: ResearchSearchProbeOutcome;
  perturbations: Array<
    | { kind: ResearchSearchPerturbationKind; skipped: SkippedResearchSearchPerturbation }
    | {
        kind: ResearchSearchPerturbationKind;
        perturbedQuery: string;
        outcome: ResearchSearchProbeOutcome;
      }
  >;
  redactQuery: boolean;
}): ResearchSearchRelevanceCaseResult {
  const { searchCase, topK, baseline, perturbations, redactQuery } = input;

  return {
    label: searchCase.label,
    queryClass: searchCase.queryClass,
    ...(redactQuery
      ? { queryShape: researchSearchQueryShape(searchCase.query) }
      : { query: searchCase.query }),
    topK,
    resultCount: baseline.resultIds.length,
    estimatedTotalHits: baseline.estimatedTotalHits,
    degraded: baseline.degraded,
    latencyMs: baseline.latencyMs,
    precisionAtK: roundedRatio(precisionAtDepth(baseline.relevanceFlags, topK)),
    reciprocalRank: roundedRatio(reciprocalRank(baseline.relevanceFlags)),
    perturbations: perturbations.map((perturbation) => {
      if ('skipped' in perturbation) {
        return { kind: perturbation.kind, skippedReason: perturbation.skipped.skippedReason };
      }
      const { outcome } = perturbation;
      return {
        kind: perturbation.kind,
        ...(redactQuery ? {} : { perturbedQuery: perturbation.perturbedQuery }),
        resultCount: outcome.resultIds.length,
        estimatedTotalHits: outcome.estimatedTotalHits,
        degraded: outcome.degraded,
        averageOverlap: roundedRatio(
          averageOverlapAtDepth(baseline.resultIds, outcome.resultIds, topK),
        ),
        jaccard: roundedRatio(jaccardAtDepth(baseline.resultIds, outcome.resultIds, topK)),
        topRankPreserved:
          baseline.resultIds.length > 0 && baseline.resultIds[0] === outcome.resultIds[0],
        precisionAtK: roundedRatio(precisionAtDepth(outcome.relevanceFlags, topK)),
      };
    }),
  };
}

export interface ResearchSearchRelevanceThresholds {
  minPrecisionAtK: number;
  minAverageOverlap: number;
}

export interface ResearchSearchRelevanceFinding {
  label: string;
  kind: 'low-precision' | 'zero-results' | 'degraded' | 'typo-collapse';
  perturbationKind?: ResearchSearchPerturbationKind;
  observed: number;
  threshold?: number;
}

export function findResearchSearchRelevanceFindings(
  cases: readonly ResearchSearchRelevanceCaseResult[],
  thresholds: ResearchSearchRelevanceThresholds,
): ResearchSearchRelevanceFinding[] {
  const findings: ResearchSearchRelevanceFinding[] = [];
  for (const caseResult of cases) {
    if (caseResult.resultCount === 0) {
      findings.push({ label: caseResult.label, kind: 'zero-results', observed: 0 });
    }
    if (caseResult.degraded) {
      findings.push({ label: caseResult.label, kind: 'degraded', observed: 1 });
    }
    if (caseResult.resultCount > 0 && caseResult.precisionAtK < thresholds.minPrecisionAtK) {
      findings.push({
        label: caseResult.label,
        kind: 'low-precision',
        observed: caseResult.precisionAtK,
        threshold: thresholds.minPrecisionAtK,
      });
    }
    for (const perturbation of caseResult.perturbations) {
      if (perturbation.skippedReason || perturbation.averageOverlap === undefined) continue;
      if (perturbation.averageOverlap < thresholds.minAverageOverlap) {
        findings.push({
          label: caseResult.label,
          kind: 'typo-collapse',
          perturbationKind: perturbation.kind,
          observed: perturbation.averageOverlap,
          threshold: thresholds.minAverageOverlap,
        });
      }
    }
  }
  return findings;
}

// Two runs are only comparable if the configuration that produced them is on the
// artifact: the levers a ranking change reaches for (rankingRules, the typo
// thresholds, the synonyms map, the searchable attributes) all live in index
// settings, and the rest of the retrieval path lives in the source tree.
export interface ResearchSearchIndexConfiguration {
  settingsFingerprint: string;
  searchableAttributes: string[];
  rankingRules: string[];
  minWordSizeForTypos: Record<string, number>;
  synonymTermCount: number;
  embedderNames: string[];
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const plainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function researchSearchIndexConfiguration(
  settings: unknown,
): ResearchSearchIndexConfiguration {
  const source = plainObject(settings);
  const typoTolerance = plainObject(source.typoTolerance);
  const minWordSizeForTypos = plainObject(typoTolerance.minWordSizeForTypos);
  return {
    settingsFingerprint: phase0ResearchSearchSettingsFingerprint(settings),
    searchableAttributes: stringArray(source.searchableAttributes),
    rankingRules: stringArray(source.rankingRules),
    minWordSizeForTypos: Object.fromEntries(
      Object.entries(minWordSizeForTypos)
        .filter(([, value]) => Number.isSafeInteger(value))
        .map(([key, value]) => [key, Number(value)]),
    ),
    synonymTermCount: Object.keys(plainObject(source.synonyms)).length,
    embedderNames: Object.keys(plainObject(source.embedders)).sort(),
  };
}

export interface ResearchSearchRelevanceReport {
  schemaVersion: 1;
  artifactType: 'research-search-relevance';
  generatedAt: string;
  sourceCommit: string;
  sourceWorktreeDirty: boolean;
  databaseName: string;
  indexName: string;
  numberOfDocuments: number;
  hybridEmbedderConfigured: boolean;
  indexConfiguration: ResearchSearchIndexConfiguration;
  // A hit whose slug has no index document cannot be judged on the text the
  // searcher matched, so it falls back to the served card and is counted here
  // rather than silently scoring as irrelevant.
  unresolvedIndexDocuments: number;
  suite: {
    topK: number;
    caseCount: number;
    perturbationKinds: ResearchSearchPerturbationKind[];
  };
  thresholds: ResearchSearchRelevanceThresholds;
  summary: {
    meanPrecisionAtK: number;
    meanReciprocalRank: number;
    meanAverageOverlap: number;
    meanAverageOverlapByKind: Record<string, number>;
    comparedPerturbations: number;
    skippedPerturbations: number;
    zeroResultCases: number;
    degradedCases: number;
    findingCount: number;
    reviewRequired: boolean;
  };
  findings: ResearchSearchRelevanceFinding[];
  cases: ResearchSearchRelevanceCaseResult[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

export function buildResearchSearchRelevanceReport(input: {
  generatedAt: string;
  sourceCommit: string;
  sourceWorktreeDirty: boolean;
  databaseName: string;
  indexName: string;
  numberOfDocuments: number;
  hybridEmbedderConfigured: boolean;
  indexConfiguration: ResearchSearchIndexConfiguration;
  unresolvedIndexDocuments: number;
  topK: number;
  perturbationKinds: readonly ResearchSearchPerturbationKind[];
  thresholds: ResearchSearchRelevanceThresholds;
  cases: readonly ResearchSearchRelevanceCaseResult[];
}): ResearchSearchRelevanceReport {
  // A case whose clean query returned nothing scores overlap 1 against every
  // perturbation, because two empty result sets really are identical. That is a
  // true statement about a query with no answer and a false statement about typo
  // robustness, so a zero-result baseline is excluded from the overlap aggregates
  // exactly as it is from mean precision. Its `zero-results` finding still fires,
  // so the case is reported rather than hidden.
  const overlapComparableCases = input.cases.filter((caseResult) => caseResult.resultCount > 0);
  const comparedPerturbations = overlapComparableCases.flatMap((caseResult) =>
    caseResult.perturbations.filter(
      (perturbation) => !perturbation.skippedReason && perturbation.averageOverlap !== undefined,
    ),
  );
  const skippedPerturbations = input.cases.reduce(
    (total, caseResult) =>
      total + caseResult.perturbations.filter((perturbation) => perturbation.skippedReason).length,
    0,
  );
  const overlapsByKind = new Map<string, number[]>();
  for (const caseResult of overlapComparableCases) {
    for (const perturbation of caseResult.perturbations) {
      if (perturbation.skippedReason || perturbation.averageOverlap === undefined) continue;
      const existing = overlapsByKind.get(perturbation.kind) || [];
      existing.push(perturbation.averageOverlap);
      overlapsByKind.set(perturbation.kind, existing);
    }
  }
  const findings = findResearchSearchRelevanceFindings(input.cases, input.thresholds);

  return {
    schemaVersion: 1,
    artifactType: 'research-search-relevance',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    sourceWorktreeDirty: input.sourceWorktreeDirty,
    databaseName: input.databaseName,
    indexName: input.indexName,
    numberOfDocuments: input.numberOfDocuments,
    hybridEmbedderConfigured: input.hybridEmbedderConfigured,
    indexConfiguration: input.indexConfiguration,
    unresolvedIndexDocuments: Math.max(0, Math.floor(input.unresolvedIndexDocuments)),
    suite: {
      topK: input.topK,
      caseCount: input.cases.length,
      perturbationKinds: [...input.perturbationKinds],
    },
    thresholds: input.thresholds,
    summary: {
      meanPrecisionAtK: roundedRatio(
        mean(
          input.cases
            .filter((caseResult) => caseResult.resultCount > 0)
            .map((caseResult) => caseResult.precisionAtK),
        ),
      ),
      meanReciprocalRank: roundedRatio(
        mean(input.cases.map((caseResult) => caseResult.reciprocalRank)),
      ),
      meanAverageOverlap: roundedRatio(
        mean(comparedPerturbations.map((perturbation) => perturbation.averageOverlap as number)),
      ),
      meanAverageOverlapByKind: Object.fromEntries(
        [...overlapsByKind.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([kind, values]) => [kind, roundedRatio(mean(values))]),
      ),
      comparedPerturbations: comparedPerturbations.length,
      skippedPerturbations,
      zeroResultCases: input.cases.filter((caseResult) => caseResult.resultCount === 0).length,
      degradedCases: input.cases.filter((caseResult) => caseResult.degraded).length,
      findingCount: findings.length,
      reviewRequired: findings.length > 0,
    },
    findings,
    cases: [...input.cases],
  };
}
