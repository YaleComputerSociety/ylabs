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
  guardExpectedCount: number;
  servedVersionMatchesStored: boolean;
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
  };

  for (const observation of observations) {
    if (!observation.servedVersionMatchesStored) {
      tally.skippedStaleIndex += 1;
      continue;
    }
    tally.comparable += 1;
    if (observation.servedCount >= observation.storedCount) continue;
    tally.dropped += 1;
    if (observation.servedCount === observation.guardExpectedCount) tally.attributedToGuard += 1;
    else tally.unexplained += 1;

    if (observation.servedCount === 0 && observation.storedCount > 0) {
      tally.servedNoneWhileStoringSome += 1;
      if (observation.guardExpectedCount !== 0) tally.servedNoneUnexplained += 1;
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
): InvariantResult {
  const disagreements = observations
    .filter((observation) => observation.facetCount !== observation.filteredTotal)
    .map((observation) => ({
      value: observation.value,
      facetCount: observation.facetCount,
      filteredTotal: observation.filteredTotal,
    }));

  return buildInvariant(
    'facet-count-agrees-with-filtered-total',
    'A facet value count equals the total of a search filtered to that value',
    disagreements.length === 0,
    { checked: observations.length, disagreements },
  );
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

const PAGE_DISTINCTNESS_ID = 'no-row-repeats-across-pages';
const PAGE_DISTINCTNESS_TITLE = 'Paging through browse never serves the same row twice';

export function checkNoRepeatedRowsAcrossPages(
  pages: ReadonlyArray<readonly string[]>,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
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
    pages: pages.length,
    rowsServed: pages.reduce((total, page) => total + page.length, 0),
    distinctRowsServed: seen.size,
    repeatedRowCount: repeated,
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

export function checkTopicDropAttribution(
  tally: TopicAttributionTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'every-topic-drop-is-attributable';
  const title = 'No browse card withholds a topic the coherence guard does not account for';

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
