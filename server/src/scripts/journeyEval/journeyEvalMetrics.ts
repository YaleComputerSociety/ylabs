export interface InvariantResult {
  id: string;
  title: string;
  passed: boolean;
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

export interface TopicDropObservation {
  storedCount: number;
  servedCount: number;
  guardExpectedCount: number;
}

export interface TopicAttributionTally {
  window: number;
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
    dropped: 0,
    attributedToGuard: 0,
    unexplained: 0,
    servedNoneWhileStoringSome: 0,
    servedNoneUnexplained: 0,
  };

  for (const observation of observations) {
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

  return {
    id: 'facet-count-agrees-with-filtered-total',
    title: 'A facet value count equals the total of a search filtered to that value',
    passed: disagreements.length === 0,
    detail: { checked: observations.length, disagreements },
  };
}

export function checkNoRepeatedRowsAcrossPages(
  pages: ReadonlyArray<readonly string[]>,
): InvariantResult {
  const seen = new Set<string>();
  let repeated = 0;
  for (const page of pages) {
    for (const key of page) {
      if (seen.has(key)) repeated += 1;
      else seen.add(key);
    }
  }

  return {
    id: 'no-row-repeats-across-pages',
    title: 'Paging through browse never serves the same row twice',
    passed: repeated === 0,
    detail: {
      pages: pages.length,
      rowsServed: pages.reduce((total, page) => total + page.length, 0),
      distinctRowsServed: seen.size,
      repeatedRowCount: repeated,
    },
  };
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

  return {
    id: `sort-${order}-is-ordered`,
    title: `A browse sorted ${order} is returned in that order`,
    passed: inversions === 0,
    detail: { returned: values.length, comparable: comparable.length, inversions },
  };
}

export function checkNotDegraded(id: string, title: string, degraded: unknown): InvariantResult {
  return {
    id,
    title,
    passed: degraded === false,
    detail: { degraded },
  };
}

export interface JourneyEvalSummary {
  invariantsChecked: number;
  invariantsFailed: number;
  failedInvariantIds: string[];
}

export function summarizeInvariants(results: readonly InvariantResult[]): JourneyEvalSummary {
  const failed = results.filter((result) => !result.passed);
  return {
    invariantsChecked: results.length,
    invariantsFailed: failed.length,
    failedInvariantIds: failed.map((result) => result.id),
  };
}
