export type InvariantStatus = 'pass' | 'fail' | 'inconclusive';

export interface InvariantResult {
  id: string;
  title: string;
  status: InvariantStatus;
  detail: Record<string, unknown>;
}

export interface RateResult {
  id: string;
  title: string;
  numerator: number;
  denominator: number;
  rate: number;
}

export const asRate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));

export const buildRate = (
  id: string,
  title: string,
  numerator: number,
  denominator: number,
): RateResult => ({ id, title, numerator, denominator, rate: asRate(numerator, denominator) });

export const buildInvariant = (
  id: string,
  title: string,
  holds: boolean,
  detail: Record<string, unknown>,
): InvariantResult => ({ id, title, status: holds ? 'pass' : 'fail', detail });

export const buildInconclusiveInvariant = (
  id: string,
  title: string,
  reason: string,
  detail: Record<string, unknown>,
): InvariantResult => ({ id, title, status: 'inconclusive', detail: { reason, ...detail } });

export interface TopicDropObservation {
  storedCount: number;
  servedCount: number;
  explainedByDecision: boolean;
  withheldBy: readonly string[];
  servedVersionMatchesStored: boolean;
}

export interface TopicDropAttribution {
  attributed: boolean;
  withheldBy: string[];
}

export interface TopicAttributionTally {
  window: number;
  comparable: number;
  skippedStaleIndex: number;
  dropped: number;
  attributedToGuard: number;
  unexplained: number;
  servedNoneWhileStoringSome: number;
  servedNoneUnexplained: number;
  drops: TopicDropAttribution[];
}

export function attributeTopicDrops(
  observations: readonly TopicDropObservation[],
): TopicAttributionTally {
  const tally: TopicAttributionTally = {
    window: observations.length,
    comparable: 0,
    skippedStaleIndex: 0,
    dropped: 0,
    attributedToGuard: 0,
    unexplained: 0,
    servedNoneWhileStoringSome: 0,
    servedNoneUnexplained: 0,
    drops: [],
  };

  for (const observation of observations) {
    if (!observation.servedVersionMatchesStored) {
      tally.skippedStaleIndex += 1;
      continue;
    }
    tally.comparable += 1;
    if (observation.servedCount >= observation.storedCount) continue;
    tally.dropped += 1;
    const attributed = observation.explainedByDecision;
    if (attributed) tally.attributedToGuard += 1;
    else tally.unexplained += 1;
    tally.drops.push({ attributed, withheldBy: [...new Set(observation.withheldBy)] });

    if (observation.servedCount === 0 && observation.storedCount > 0) {
      tally.servedNoneWhileStoringSome += 1;
      if (!attributed) tally.servedNoneUnexplained += 1;
    }
  }

  return tally;
}

export interface FacetAgreementObservation {
  value: string;
  facetCount: number;
  filteredTotal: number;
}

export function checkFacetAgreement(
  observations: readonly FacetAgreementObservation[],
  invariant: { id: string; title: string } = {
    id: 'facet-count-agrees-with-filtered-total',
    title: 'A facet value count equals the total of a search filtered to that value',
  },
): InvariantResult {
  const disagreements = observations
    .filter((observation) => observation.facetCount !== observation.filteredTotal)
    .map((observation) => ({
      value: observation.value,
      facetCount: observation.facetCount,
      filteredTotal: observation.filteredTotal,
    }));

  return buildInvariant(invariant.id, invariant.title, disagreements.length === 0, {
    checked: observations.length,
    disagreements,
  });
}

export interface CorpusFingerprint {
  rowCount: number;
  latestUpdatedAt: string | null;
}

export const corpusFingerprintMoved = (
  before: CorpusFingerprint,
  after: CorpusFingerprint,
): boolean =>
  before.rowCount !== after.rowCount || before.latestUpdatedAt !== after.latestUpdatedAt;

export const resolvePagesToWalk = (pagesRequested: number, reachablePages: number): number =>
  Math.max(1, Math.min(Math.max(1, Math.floor(pagesRequested) || 1), Math.max(1, reachablePages)));

export interface PageWalkDepth {
  pagesRequested: number;
  reachablePages: number;
}

const PAGE_DISTINCTNESS_ID = 'no-row-repeats-across-pages';
const PAGE_DISTINCTNESS_TITLE = 'Paging through browse never serves the same row twice';

export function checkNoRepeatedRowsAcrossPages(
  pages: ReadonlyArray<readonly string[]>,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
  depth?: PageWalkDepth,
): InvariantResult {
  const seen = new Set<string>();
  let repeated = 0;
  for (const page of pages) {
    for (const key of page) {
      if (seen.has(key)) repeated += 1;
      else seen.add(key);
    }
  }

  const detail = {
    pagesWalked: pages.length,
    rowsServed: pages.reduce((total, page) => total + page.length, 0),
    distinctRowsServed: seen.size,
    repeatedRowCount: repeated,
    ...(depth
      ? {
          pagesRequested: depth.pagesRequested,
          reachablePages: depth.reachablePages,
          walkTruncatedByDepthBound: depth.pagesRequested > depth.reachablePages,
        }
      : {}),
  };

  if (repeated > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      PAGE_DISTINCTNESS_ID,
      PAGE_DISTINCTNESS_TITLE,
      'The corpus changed while the pages were walked, so a row may have moved across a page boundary for a reason the serving code does not control',
      { ...detail, corpusBefore, corpusAfter },
    );
  }

  return buildInvariant(PAGE_DISTINCTNESS_ID, PAGE_DISTINCTNESS_TITLE, repeated === 0, detail);
}

const REPEATABLE_BROWSE_ORDER_ID = 'default-browse-order-is-repeatable';
const REPEATABLE_BROWSE_ORDER_TITLE =
  'Two walks of the default browse over an unchanged corpus serve the same rows in the same order';

export function checkDefaultBrowseOrderIsRepeatable(
  firstWalk: ReadonlyArray<readonly string[]>,
  secondWalk: ReadonlyArray<readonly string[]>,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const first = firstWalk.flat();
  const second = secondWalk.flat();
  const length = Math.max(first.length, second.length);
  let firstDivergentPosition = -1;
  for (let position = 0; position < length; position += 1) {
    if (first[position] !== second[position]) {
      firstDivergentPosition = position;
      break;
    }
  }
  const detail = {
    pagesWalked: firstWalk.length,
    rowsCompared: length,
    firstDivergentPosition,
  };
  if (firstDivergentPosition >= 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      REPEATABLE_BROWSE_ORDER_ID,
      REPEATABLE_BROWSE_ORDER_TITLE,
      'The corpus changed between the two walks, so a reordering may come from a rescored row rather than an unstable tiebreak',
      { ...detail, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(
    REPEATABLE_BROWSE_ORDER_ID,
    REPEATABLE_BROWSE_ORDER_TITLE,
    firstDivergentPosition < 0,
    detail,
  );
}

export function checkTopicDropAttribution(
  tally: TopicAttributionTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'every-topic-drop-is-attributable';
  const title = 'No browse card withholds a topic the served topic guards do not account for';

  if (tally.comparable === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No sampled row could be compared, so a zero unexplained count would be a green signal over an empty population',
      { ...tally },
    );
  }

  if (tally.unexplained > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the sample was compared, so a drop may be unexplained only because the indexed value and the stored value describe different versions',
      { ...tally, corpusBefore, corpusAfter },
    );
  }

  return buildInvariant(id, title, tally.unexplained === 0, { ...tally });
}

export interface CreativePracticeLabelObservation {
  served: boolean;
  decided: boolean;
  servedVersionMatchesStored: boolean;
}

export interface CreativePracticeLabelTally {
  comparable: number;
  labelled: number;
  disagreeing: number;
  skippedStaleIndex: number;
}

export function tallyCreativePracticeLabels(
  observations: readonly CreativePracticeLabelObservation[],
): CreativePracticeLabelTally {
  const comparable = observations.filter((observation) => observation.servedVersionMatchesStored);
  return {
    comparable: comparable.length,
    labelled: comparable.filter((observation) => observation.served).length,
    disagreeing: comparable.filter((observation) => observation.served !== observation.decided)
      .length,
    skippedStaleIndex: observations.length - comparable.length,
  };
}

export function checkCreativePracticeLabelAttribution(
  tally: CreativePracticeLabelTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'creative-practice-label-is-the-decision';
  const title =
    'Every browse card serves the creative practice label exactly when the served-copy decision does';

  if (tally.comparable === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No sampled row could be compared, so zero disagreements would be a green signal over an empty population',
      { ...tally },
    );
  }

  if (tally.disagreeing > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the sample was compared, so a card may disagree only because it and the stored row describe different versions',
      { ...tally, corpusBefore, corpusAfter },
    );
  }

  return buildInvariant(id, title, tally.disagreeing === 0, { ...tally });
}

export type SurvivorWebsiteAttribution =
  | 'locked'
  | 'survivor-evidence'
  | 'loser-only-under-owned-slot'
  | 'merged-loser-evidence'
  | 'unbacked';

export interface SurvivorWebsiteObservation {
  servedWebsiteIdentity: string;
  websiteLocked: boolean;
  survivorStated: ReadonlySet<string>;
  admittedStated: ReadonlySet<string>;
  droppedLoser: ReadonlySet<string>;
}

export function classifySurvivorWebsite(
  observation: SurvivorWebsiteObservation,
): SurvivorWebsiteAttribution {
  const served = observation.servedWebsiteIdentity;
  if (observation.websiteLocked) return 'locked';
  if (observation.survivorStated.has(served)) return 'survivor-evidence';
  if (observation.droppedLoser.has(served)) return 'loser-only-under-owned-slot';
  if (observation.admittedStated.has(served)) return 'merged-loser-evidence';
  return 'unbacked';
}

export interface SurvivorWebsiteTally {
  comparable: number;
  byAttribution: Record<SurvivorWebsiteAttribution, number>;
}

export function tallySurvivorWebsites(
  observations: readonly SurvivorWebsiteObservation[],
): SurvivorWebsiteTally {
  const byAttribution: Record<SurvivorWebsiteAttribution, number> = {
    locked: 0,
    'survivor-evidence': 0,
    'loser-only-under-owned-slot': 0,
    'merged-loser-evidence': 0,
    unbacked: 0,
  };
  let comparable = 0;
  for (const observation of observations) {
    if (!observation.servedWebsiteIdentity) continue;
    comparable += 1;
    byAttribution[classifySurvivorWebsite(observation)] += 1;
  }
  return { comparable, byAttribution };
}

/**
 * The defect class of #3585 is a served survivor website that only a merged-in
 * loser states while the survivor's own lab-identity lane owns the slot. `unbacked`
 * is reported but never asserted here, because a value no evidence states is its
 * own defect class (#3586) with its own causes.
 */
export function checkSurvivorWebsiteAttribution(
  tally: SurvivorWebsiteTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'survivor-website-is-not-a-loser-lab-identity';
  const title =
    'No served merged survivor serves a website only a loser states while its own lab-identity lane owns the slot';
  const violations = tally.byAttribution['loser-only-under-owned-slot'];

  if (tally.comparable === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No served merged survivor serves a website, so a zero count would be a green signal over an empty population',
      { ...tally },
    );
  }
  if (violations > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the survivors were read, so a served value and its evidence may describe different versions',
      { ...tally, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, violations === 0, { ...tally });
}

export function checkSortOrdering(
  values: readonly (number | null)[],
  order: 'asc' | 'desc',
): InvariantResult {
  const comparable = values.filter((value): value is number => typeof value === 'number');
  let inversions = 0;
  for (let index = 1; index < comparable.length; index += 1) {
    const previous = comparable[index - 1];
    const current = comparable[index];
    if (order === 'desc' ? current > previous : current < previous) inversions += 1;
  }

  return buildInvariant(
    `sort-${order}-is-ordered`,
    `A browse sorted ${order} is returned in that order`,
    inversions === 0,
    { returned: values.length, comparable: comparable.length, inversions },
  );
}

export interface IndexedSortKeyObservation {
  inIndex: boolean;
  matchesStored: boolean;
  writtenDuringRead: boolean;
}

export function checkIndexedSortKeyMatchesStored(
  sortAttribute: string,
  observations: readonly IndexedSortKeyObservation[],
): InvariantResult {
  const settled = observations.filter((observation) => !observation.writtenDuringRead);
  const stale = settled.filter(
    (observation) => observation.inIndex && !observation.matchesStored,
  ).length;
  const tally = {
    sortAttribute,
    compared: settled.length,
    stale,
    missingFromIndex: settled.filter((observation) => !observation.inIndex).length,
    writtenDuringRead: observations.length - settled.length,
  };
  const id = 'indexed-sort-key-is-fresh';
  const title = `Every served row is sorted on the ${sortAttribute} its stored row derives now`;
  if (settled.length === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No served row settled before the read, so a zero stale count would be a green signal over an empty population',
      tally,
    );
  }
  return buildInvariant(
    id,
    title,
    stale === 0,
    stale === 0
      ? tally
      : {
          ...tally,
          remedy:
            'The index predates these rows; on Development run yarn development:search:sync, elsewhere rebuild it per docs/meilisearch-reindex-runbook.md',
        },
  );
}

export function checkTitleSortOrdering(
  sortTitles: readonly string[],
  order: 'asc' | 'desc',
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = `sort-title-${order}-follows-card-title`;
  const title = `A browse sorted A-Z ${order} is ordered by the title each card shows`;
  let inversions = 0;
  for (let index = 1; index < sortTitles.length; index += 1) {
    const previous = sortTitles[index - 1];
    const current = sortTitles[index];
    if (order === 'asc' ? current < previous : current > previous) inversions += 1;
  }
  const tally = { returned: sortTitles.length, inversions };
  if (inversions > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the pages were read, so a row may have moved between two requests',
      { ...tally, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, inversions === 0, tally);
}

export function checkConstantReportedTotal(
  query: string,
  totals: readonly (number | null)[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'text-query-total-is-constant-across-pages';
  const title = 'A text query reports the same total on every page a student scrolls';
  const distinctTotals = [...new Set(totals)];
  const constant = distinctTotals.length === 1 && typeof distinctTotals[0] === 'number';
  const tally = { query, pagesWalked: totals.length, firstTotal: totals[0], distinctTotals };
  if (!constant && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the pages were read, so two pages may describe different corpora',
      { ...tally, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, constant, tally);
}

export function checkNotDegraded(id: string, title: string, degraded: unknown): InvariantResult {
  return buildInvariant(id, title, degraded === false, { degraded });
}

export interface JourneyEvalSummary {
  invariantsChecked: number;
  invariantsFailed: number;
  invariantsInconclusive: number;
  failedInvariantIds: string[];
  inconclusiveInvariantIds: string[];
}

export function summarizeInvariants(results: readonly InvariantResult[]): JourneyEvalSummary {
  const failed = results.filter((result) => result.status === 'fail');
  const inconclusive = results.filter((result) => result.status === 'inconclusive');
  return {
    invariantsChecked: results.length,
    invariantsFailed: failed.length,
    invariantsInconclusive: inconclusive.length,
    failedInvariantIds: failed.map((result) => result.id),
    inconclusiveInvariantIds: inconclusive.map((result) => result.id),
  };
}

export interface QueryRelevanceScore {
  query: string;
  served: number;
  judged: number;
  relevant: number;
  precisionAtK: number;
  firstRelevantRank: number | null;
}

export function scoreQueryRelevance(
  query: string,
  relevanceByRank: readonly boolean[],
  topK: number,
  servedTotal: number,
): QueryRelevanceScore {
  const judgedFlags = relevanceByRank.slice(0, topK);
  const relevant = judgedFlags.filter(Boolean).length;
  const firstRelevantIndex = judgedFlags.indexOf(true);

  return {
    query,
    served: servedTotal,
    judged: judgedFlags.length,
    relevant,
    precisionAtK: asRate(relevant, judgedFlags.length),
    firstRelevantRank: firstRelevantIndex === -1 ? null : firstRelevantIndex + 1,
  };
}

export function checkQueryRelevance(
  score: QueryRelevanceScore,
  minRelevant: number,
): InvariantResult {
  const id = `query-relevance:${score.query}`;
  const title = `A search for "${score.query}" returns at least ${minRelevant} relevant results in its top ${score.judged || 'K'}`;

  if (score.judged === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The query returned nothing to judge, so a relevance score over it would be a green signal over an empty population',
      { ...score, minRelevant },
    );
  }

  return buildInvariant(id, title, score.relevant >= minRelevant, { ...score, minRelevant });
}

export function checkExpectedNoResults(query: string, servedTotal: number): InvariantResult {
  return buildInvariant(
    `query-returns-nothing:${query}`,
    `A search for "${query}" legitimately returns nothing rather than erroring`,
    servedTotal === 0,
    { query, served: servedTotal },
  );
}

export interface ServedQueryPair {
  baselineQuery: string;
  baselineKeys: readonly string[];
  variantQuery: string;
  variantKeys: readonly string[];
}

export type QueryVariantAgreement = 'sameOrderedRows' | 'coversBaselineRows' | 'sharesABaselineRow';

const variantAgrees = (pair: ServedQueryPair, agreement: QueryVariantAgreement): boolean => {
  if (agreement === 'coversBaselineRows') {
    const variantKeys = new Set(pair.variantKeys);
    return pair.baselineKeys.every((key) => variantKeys.has(key));
  }
  if (agreement === 'sharesABaselineRow') {
    const variantKeys = new Set(pair.variantKeys);
    return pair.baselineKeys.some((key) => variantKeys.has(key));
  }
  return (
    pair.baselineKeys.length === pair.variantKeys.length &&
    pair.baselineKeys.every((key, index) => pair.variantKeys[index] === key)
  );
};

export function checkQueryVariantServesTheBaseline(
  id: string,
  title: string,
  pairs: readonly ServedQueryPair[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
  agreement: QueryVariantAgreement = 'sameOrderedRows',
): InvariantResult {
  const compared = pairs.map((pair) => ({
    baselineQuery: pair.baselineQuery,
    variantQuery: pair.variantQuery,
    baselineServed: pair.baselineKeys.length,
    variantServed: pair.variantKeys.length,
    agrees: variantAgrees(pair, agreement),
  }));
  const detail = { agreement, pairs: compared };
  if (compared.some((pair) => pair.baselineServed === 0)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'A baseline query served no rows, so agreement with it would be a green signal over an empty population',
      detail,
    );
  }
  const disagreeing = compared.filter((pair) => !pair.agrees).length;
  if (disagreeing > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed between the two queries, so a ranking difference may be a write rather than the query',
      { ...detail, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, disagreeing === 0, detail);
}

export type QueryEvidenceClass = 'ownEvidence' | 'meshDescriptorOnly' | 'other';

export interface QueryEvidenceRanking {
  query: string;
  topClasses: readonly QueryEvidenceClass[];
  meshDescriptorOnlyServed: number;
}

export function checkMeshDescriptorOnlyRowsRankBelowOwnEvidence(
  rankings: readonly QueryEvidenceRanking[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'mesh-descriptor-only-rows-rank-below-own-evidence';
  const title =
    'No row matching a query only through a MeSH descriptor outranks a row whose own text names the query';
  const perQuery = rankings.map((ranking) => {
    const lastOwnEvidenceRank = ranking.topClasses.lastIndexOf('ownEvidence');
    const outranking = ranking.topClasses.filter(
      (evidence, rank) => evidence === 'meshDescriptorOnly' && rank < lastOwnEvidenceRank,
    ).length;
    return {
      query: ranking.query,
      ranked: ranking.topClasses.length,
      ownEvidenceInTop: ranking.topClasses.filter((evidence) => evidence === 'ownEvidence').length,
      meshDescriptorOnlyInTop: ranking.topClasses.filter(
        (evidence) => evidence === 'meshDescriptorOnly',
      ).length,
      meshDescriptorOnlyServed: ranking.meshDescriptorOnlyServed,
      meshDescriptorOnlyOutrankingOwnEvidence: outranking,
    };
  });
  const detail = {
    queries: perQuery,
    unexercisedQueries: perQuery
      .filter((query) => query.meshDescriptorOnlyServed === 0)
      .map((query) => query.query),
  };
  // A query whose descriptor-only rows rank below the served window exercised nothing, which is
  // also what a correct demotion looks like, so it must not make the queries that did serve
  // such rows inconclusive (#4538). Only an all-empty population is a green signal over nothing.
  if (perQuery.every((query) => query.meshDescriptorOnlyServed === 0)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No query served a MeSH-descriptor-only row, so the ordering it asserts was never exercised',
      detail,
    );
  }
  const violations = perQuery.reduce(
    (total, query) => total + query.meshDescriptorOnlyOutrankingOwnEvidence,
    0,
  );
  if (violations > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the rows were classified, so a stored row may describe a different version than the one ranked',
      { ...detail, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, violations === 0, detail);
}

export interface PersonNameQueryObservation {
  variant: 'prefix' | 'typo';
  respelled: boolean;
  rank: number | null;
}

export function checkPersonNameWordsAreNotRespelled(
  observations: readonly PersonNameQueryObservation[],
): InvariantResult {
  const id = 'person-name-words-are-not-respelled';
  const title =
    'A query word that starts or is one edit from a served person name is searched as typed, never spelling-corrected';
  const respelled = observations.filter((observation) => observation.respelled);
  const detail = {
    queried: observations.length,
    respelled: respelled.length,
    respelledByVariant: {
      prefix: respelled.filter((observation) => observation.variant === 'prefix').length,
      typo: respelled.filter((observation) => observation.variant === 'typo').length,
    },
  };
  if (observations.length === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No served row offered a person name to query, so a zero respelled count would be a green signal over an empty population',
      detail,
    );
  }
  return buildInvariant(id, title, respelled.length === 0, detail);
}

export interface SimilarRailObservation {
  viewedSharesNames: boolean;
  cardsShareAName: readonly boolean[];
}

const sharedNameCardPrecedesTopicalCard = (cardsShareAName: readonly boolean[]): boolean =>
  cardsShareAName.some(
    (sharesAName, position) =>
      sharesAName && cardsShareAName.slice(position + 1).some((later) => !later),
  );

export function checkSimilarRailRanksSharedNamesLast(
  rails: readonly SimilarRailObservation[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'similar-rail-ranks-shared-names-last';
  const title =
    'A "More like this" card sharing a person name with the viewed row never ranks above a card that does not';
  const comparable = rails.filter(
    (rail) => rail.viewedSharesNames && rail.cardsShareAName.length > 0,
  );
  const misordered = comparable.filter((rail) =>
    sharedNameCardPrecedesTopicalCard(rail.cardsShareAName),
  ).length;
  const detail = { railsRead: rails.length, railsWithNames: comparable.length, misordered };
  if (comparable.length === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No rail belonged to a row with person names, so a zero misordered count would be a green signal over an empty population',
      detail,
    );
  }
  if (misordered > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the rails were read, so a card may carry names from a different version',
      { ...detail, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, misordered === 0, detail);
}
