import { createHash } from 'crypto';
import {
  UNDERGRAD_EVIDENCE_VERDICTS,
  type UndergradEvidenceJudgement,
  type UndergradEvidenceVerdict,
} from './journeyEvalJudgements';

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

export interface ProportionInterval {
  low: number;
  high: number;
  z: number;
}

const Z_95 = 1.959964;

const roundTo4 = (value: number): number => Number(value.toFixed(4));

export function wilsonInterval(
  successes: number,
  trials: number,
  z: number = Z_95,
): ProportionInterval | null {
  if (trials <= 0) return null;
  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const centre = proportion + zSquared / (2 * trials);
  const margin =
    z * Math.sqrt((proportion * (1 - proportion)) / trials + zSquared / (4 * trials * trials));
  return {
    low: roundTo4(Math.max(0, (centre - margin) / denominator)),
    high: roundTo4(Math.min(1, (centre + margin) / denominator)),
    z,
  };
}

export const fingerprintQuote = (quote: string): string =>
  createHash('sha256').update(quote.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

const seededDrawRank = (seed: string, rowKey: string): string =>
  createHash('sha256').update(`${seed}:${rowKey}`).digest('hex');

export function drawSeededSample(
  rowKeys: readonly string[],
  seed: string,
  sampleSize: number,
): string[] {
  return [...new Set(rowKeys)]
    .map((rowKey) => ({ rowKey, rank: seededDrawRank(seed, rowKey) }))
    .sort((left, right) => (left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0))
    .slice(0, Math.max(0, sampleSize))
    .map((entry) => entry.rowKey);
}

export const fingerprintPopulation = (rowKeys: readonly string[]): string =>
  createHash('sha256')
    .update([...new Set(rowKeys)].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);

export interface UndergradEvidenceServedRow {
  rowKey: string;
  quoteFingerprint: string;
}

export interface UndergradEvidenceJudgementScore {
  population: number;
  drawn: number;
  judged: number;
  unjudged: number;
  judgementForAChangedQuote: number;
  judgementsOutsideTheDraw: number;
  verdicts: Record<UndergradEvidenceVerdict, number>;
  verifiable: number;
  correct: number;
  badgePrecision: number;
  badgePrecisionInterval: ProportionInterval | null;
  grounded: number;
  laneGroundingPrecision: number;
  laneGroundingPrecisionInterval: ProportionInterval | null;
  badgeWordingJudged: number;
  badgeWordingBacked: number;
  badgeWordingPrecision: number;
  badgeWordingInterval: ProportionInterval | null;
}

const emptyVerdictTally = (): Record<UndergradEvidenceVerdict, number> =>
  Object.fromEntries(UNDERGRAD_EVIDENCE_VERDICTS.map((verdict) => [verdict, 0])) as Record<
    UndergradEvidenceVerdict,
    number
  >;

export function scoreUndergradEvidenceJudgements(
  population: readonly UndergradEvidenceServedRow[],
  judgements: readonly UndergradEvidenceJudgement[],
  seed: string,
  sampleSize: number,
): UndergradEvidenceJudgementScore {
  const fingerprintByRow = new Map(population.map((row) => [row.rowKey, row.quoteFingerprint]));
  const judgementByRow = new Map(judgements.map((judgement) => [judgement.rowKey, judgement]));
  const drawn = drawSeededSample([...fingerprintByRow.keys()], seed, sampleSize);
  const drawnSet = new Set(drawn);

  const verdicts = emptyVerdictTally();
  let unjudged = 0;
  let judgementForAChangedQuote = 0;
  let badgeWordingJudged = 0;
  let badgeWordingBacked = 0;

  for (const rowKey of drawn) {
    const judgement = judgementByRow.get(rowKey);
    if (!judgement?.verdict) {
      unjudged += 1;
      continue;
    }
    if (judgement.quoteFingerprint !== fingerprintByRow.get(rowKey)) {
      judgementForAChangedQuote += 1;
      continue;
    }
    verdicts[judgement.verdict] += 1;
    if (
      judgement.verdict !== 'stale_or_unreachable' &&
      judgement.backsHostedBadgeWording !== undefined
    ) {
      badgeWordingJudged += 1;
      if (judgement.backsHostedBadgeWording) badgeWordingBacked += 1;
    }
  }

  const judged = Object.values(verdicts).reduce((total, count) => total + count, 0);
  const verifiable = judged - verdicts.stale_or_unreachable;
  const correct = verdicts.correct;
  const grounded = verifiable - verdicts.not_grounded;

  return {
    population: fingerprintByRow.size,
    drawn: drawn.length,
    judged,
    unjudged,
    judgementForAChangedQuote,
    judgementsOutsideTheDraw: judgements.filter((judgement) => !drawnSet.has(judgement.rowKey))
      .length,
    verdicts,
    verifiable,
    correct,
    badgePrecision: asRate(correct, verifiable),
    badgePrecisionInterval: wilsonInterval(correct, verifiable),
    grounded,
    laneGroundingPrecision: asRate(grounded, verifiable),
    laneGroundingPrecisionInterval: wilsonInterval(grounded, verifiable),
    badgeWordingJudged,
    badgeWordingBacked,
    badgeWordingPrecision: asRate(badgeWordingBacked, badgeWordingJudged),
    badgeWordingInterval: wilsonInterval(badgeWordingBacked, badgeWordingJudged),
  };
}

export interface QuoteAttributionObservation {
  servedVersionMatchesStored: boolean;
  storedSourceName: string;
}

export function checkUndergradEvidenceQuoteAttribution(
  observations: readonly QuoteAttributionObservation[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = 'undergrad-evidence-quote-names-its-source';
  const title = 'Every served undergraduate evidence quote is attributable to a named source';
  const comparable = observations.filter((observation) => observation.servedVersionMatchesStored);
  const unattributed = comparable.filter(
    (observation) => observation.storedSourceName.trim().length === 0,
  ).length;
  const detail = {
    served: observations.length,
    comparable: comparable.length,
    skippedStaleIndex: observations.length - comparable.length,
    unattributed,
  };

  if (comparable.length === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No served quote could be compared with its stored row, so a zero unattributed count would be a green signal over an empty population',
      detail,
    );
  }
  if (unattributed > 0 && corpusFingerprintMoved(corpusBefore, corpusAfter)) {
    return buildInconclusiveInvariant(
      id,
      title,
      'The corpus changed while the quotes were compared, so a quote may look unattributed only because the served and stored rows describe different versions',
      { ...detail, corpusBefore, corpusAfter },
    );
  }
  return buildInvariant(id, title, unattributed === 0, detail);
}
