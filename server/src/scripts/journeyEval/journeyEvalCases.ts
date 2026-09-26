import { dropDomainIncoherentUnsourcedResearchAreas } from '../../utils/researchAreaDomainCoherence';
import { normalizeResearchAreaList } from '../../utils/researchAreaHygiene';
import { maxReachableResearchSearchPage } from '../../services/researchSearchPagination';
import {
  attributeTopicDrops,
  buildInconclusiveInvariant,
  buildInvariant,
  buildRate,
  checkExpectedNoResults,
  checkFacetAgreement,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkQueryRelevance,
  checkSortOrdering,
  checkTopicDropAttribution,
  checkUndergradEvidenceQuoteAttribution,
  corpusFingerprintMoved,
  drawSeededSample,
  fingerprintPopulation,
  fingerprintQuote,
  resolvePagesToWalk,
  scoreQueryRelevance,
  scoreUndergradEvidenceJudgements,
  type CorpusFingerprint,
  type FacetAgreementObservation,
  type InvariantResult,
  type RateResult,
  type QuoteAttributionObservation,
  type TopicDropObservation,
  type UndergradEvidenceServedRow,
} from './journeyEvalMetrics';
import {
  DEFAULT_TOP_K,
  DEFAULT_UNDERGRAD_EVIDENCE_LANE,
  type RelevanceMatchers,
  type TopicQueryJudgement,
  type UndergradEvidenceJudgementSet,
} from './journeyEvalJudgements';

export interface ServedBrowseResult {
  researchEntities?: unknown[];
  estimatedTotalHits?: number;
  degraded?: unknown;
  facetDistribution?: Record<string, Record<string, number>>;
}

export interface BrowseRequest {
  query?: string;
  filters?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  sort?: { sortBy?: string; sortOrder?: 'asc' | 'desc' };
}

export type BrowseFn = (request: BrowseRequest) => Promise<ServedBrowseResult>;

export type ReadStoredRowsFn = (rowKeys: string[]) => Promise<Map<string, Record<string, unknown>>>;

export interface UndergradEvidenceSampleRequest {
  seed: string;
  sampleSize: number;
  write: (sample: UndergradEvidenceJudgementSet) => Promise<string>;
}

export interface JourneyEvalContext {
  browse: BrowseFn;
  topicQueryJudgements: TopicQueryJudgement[] | null;
  undergradEvidenceJudgements?: UndergradEvidenceJudgementSet | null;
  undergradEvidenceSampleRequest?: UndergradEvidenceSampleRequest;
  readStoredRows: ReadStoredRowsFn;
  readCorpusFingerprint: () => Promise<CorpusFingerprint>;
  window: number;
  facetValuesChecked: number;
  pagesChecked: number;
}

export interface JourneyCaseOutcome {
  invariants: InvariantResult[];
  rates: RateResult[];
  notes?: Record<string, unknown>;
}

export interface JourneyCase {
  id: string;
  title: string;
  run: (context: JourneyEvalContext) => Promise<JourneyCaseOutcome>;
}

const servedRows = (result: ServedBrowseResult): Array<Record<string, unknown>> =>
  Array.isArray(result.researchEntities)
    ? (result.researchEntities as Array<Record<string, unknown>>)
    : [];

const rowKey = (row: Record<string, unknown>): string =>
  typeof row.slug === 'string' ? row.slug : '';

const listLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const epochMillis = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' || value instanceof Date) {
    const parsed = new Date(value as string).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const coldBrowseCardContract: JourneyCase = {
  id: 'cold-browse-card-contract',
  title: 'A student landing on browse with no query or filter gets renderable cards',
  run: async (context) => {
    const result = await context.browse({ page: 1, pageSize: context.window });
    const rows = servedRows(result);
    const facetKeys = Object.keys(result.facetDistribution ?? {});

    return {
      invariants: [
        checkNotDegraded(
          'cold-browse-is-not-degraded',
          'A cold browse does not fall back to a degraded search path',
          result.degraded,
        ),
        buildInvariant(
          'cold-browse-serves-facets',
          'A cold browse returns a facet distribution the filter rail can render',
          facetKeys.length > 0,
          { facetKeys },
        ),
        buildInvariant(
          'cold-browse-fills-the-page',
          'A cold browse fills the requested page when the corpus is larger than it',
          rows.length === context.window || (result.estimatedTotalHits ?? 0) < context.window,
          { requested: context.window, served: rows.length, total: result.estimatedTotalHits },
        ),
      ],
      rates: [
        buildRate(
          'browse-cards-with-a-topic',
          'Browse cards serving at least one topic',
          rows.filter((row) => listLength(row.researchAreas) > 0).length,
          rows.length,
        ),
        buildRate(
          'browse-cards-with-a-short-description',
          'Browse cards serving a non-empty short description',
          rows.filter((row) => hasText(row.shortDescription)).length,
          rows.length,
        ),
        buildRate(
          'browse-cards-with-a-name',
          'Browse cards serving a name',
          rows.filter((row) => hasText(row.name) || hasText(row.displayName)).length,
          rows.length,
        ),
      ],
    };
  },
};

const topicDropAttribution: JourneyCase = {
  id: 'topic-drop-attribution',
  title: 'Every topic a browse card withholds is attributable to the coherence guard',
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const result = await context.browse({ page: 1, pageSize: context.window });
    const rows = servedRows(result);
    const stored = await context.readStoredRows(rows.map(rowKey).filter(Boolean));

    const observations: TopicDropObservation[] = [];
    for (const row of rows) {
      const storedRow = stored.get(rowKey(row));
      if (!storedRow) continue;
      const storedAreas = Array.isArray(storedRow.researchAreas)
        ? (storedRow.researchAreas as string[])
        : [];
      const guardExpected = normalizeResearchAreaList(
        dropDomainIncoherentUnsourcedResearchAreas(storedAreas, storedRow.fieldProvenance, {
          name: storedRow.name as string,
          displayName: storedRow.displayName as string,
          departments: storedRow.departments as string[],
          shortDescription: storedRow.shortDescription as string,
          fullDescription: storedRow.fullDescription as string,
        }),
      );
      observations.push({
        storedCount: storedAreas.length,
        servedCount: listLength(row.researchAreas),
        guardExpectedCount: guardExpected.length,
        servedVersionMatchesStored:
          epochMillis(row.lastObservedAt) === epochMillis(storedRow.lastObservedAt),
      });
    }

    const tally = attributeTopicDrops(observations);
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        checkTopicDropAttribution(tally, corpusBefore, corpusAfter),
        buildInvariant(
          'serving-no-topic-is-attributable',
          'A card serving no topic while storing some is fully accounted for by the guard',
          tally.servedNoneUnexplained === 0,
          {
            servedNoneWhileStoringSome: tally.servedNoneWhileStoringSome,
            servedNoneUnexplained: tally.servedNoneUnexplained,
          },
        ),
      ],
      rates: [
        buildRate(
          'topic-drops-attributed-to-the-guard',
          'Topic drops the coherence guard accounts for',
          tally.attributedToGuard,
          tally.dropped,
        ),
      ],
      notes: { comparedRows: tally.comparable, skippedStaleIndex: tally.skippedStaleIndex },
    };
  },
};

const facetCountAgreement: JourneyCase = {
  id: 'facet-count-agreement',
  title: 'A facet count matches the result total of a search filtered to that value',
  run: async (context) => {
    const result = await context.browse({ page: 1, pageSize: context.window });
    const departmentFacet = result.facetDistribution?.departments ?? {};
    const topValues = Object.entries(departmentFacet)
      .sort((left, right) => right[1] - left[1])
      .slice(0, context.facetValuesChecked);

    const observations: FacetAgreementObservation[] = [];
    let degradedFilteredBrowses = 0;
    for (const [value, facetCount] of topValues) {
      const filtered = await context.browse({
        filters: { departments: [value] },
        page: 1,
        pageSize: 1,
      });
      observations.push({ value, facetCount, filteredTotal: filtered.estimatedTotalHits ?? -1 });
      if (filtered.degraded !== false) degradedFilteredBrowses += 1;
    }

    return {
      invariants: [
        checkFacetAgreement(observations),
        buildInvariant(
          'filtered-browse-is-not-degraded',
          'A browse filtered to one facet value does not fall back to a degraded search path',
          degradedFilteredBrowses === 0,
          { checked: observations.length, degradedFilteredBrowses },
        ),
      ],
      rates: [],
    };
  },
};

const paginationServesDistinctRows: JourneyCase = {
  id: 'pagination-serves-distinct-rows',
  title: 'Paging through browse never serves the same row twice',
  run: async (context) => {
    const reachablePages = maxReachableResearchSearchPage(context.window);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, reachablePages);
    const corpusBefore = await context.readCorpusFingerprint();
    const pages: string[][] = [];
    for (let page = 1; page <= pagesToWalk; page += 1) {
      const result = await context.browse({ page, pageSize: context.window });
      pages.push(servedRows(result).map(rowKey).filter(Boolean));
    }
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        checkNoRepeatedRowsAcrossPages(pages, corpusBefore, corpusAfter, {
          pagesRequested: context.pagesChecked,
          reachablePages,
        }),
      ],
      rates: [],
    };
  },
};

const sortedBrowseKeepsOrder: JourneyCase = {
  id: 'sorted-browse-keeps-order',
  title: 'A browse sorted by last observation is ordered and does not silently degrade',
  run: async (context) => {
    const result = await context.browse({
      page: 1,
      pageSize: context.window,
      sort: { sortBy: 'lastObservedAt', sortOrder: 'desc' },
    });
    const rows = servedRows(result);

    return {
      invariants: [
        checkNotDegraded(
          'sorted-browse-is-not-degraded',
          'A sorted browse does not silently fall back to an unsorted search path',
          result.degraded,
        ),
        checkSortOrdering(
          rows.map((row) => epochMillis(row.lastObservedAt)),
          'desc',
        ),
      ],
      rates: [],
    };
  },
};

const matchesAny = (values: readonly string[], needles: readonly string[] | undefined): boolean => {
  if (!needles || needles.length === 0) return false;
  const haystack = values.map((value) => value.toLowerCase());
  return needles.some((needle) => {
    const lowered = needle.toLowerCase();
    return haystack.some((value) => value.includes(lowered));
  });
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const cardText = (row: Record<string, unknown>): string[] =>
  [row.name, row.displayName, row.shortDescription, row.cardDescription]
    .filter((value): value is string => typeof value === 'string')
    .concat(stringList(row.researchAreas), stringList(row.departments));

const isRelevant = (row: Record<string, unknown>, matchers: RelevanceMatchers): boolean =>
  matchesAny(stringList(row.researchAreas), matchers.anyTopicMatches) ||
  matchesAny(stringList(row.departments), matchers.anyDepartmentMatches) ||
  matchesAny(cardText(row), matchers.anyTextMatches);

const topicQueryRelevance: JourneyCase = {
  id: 'topic-query-relevance',
  title: 'A search for a topic returns results about that topic',
  run: async (context) => {
    const judgements = context.topicQueryJudgements;
    if (!judgements || judgements.length === 0) {
      return {
        invariants: [
          buildInconclusiveInvariant(
            'topic-query-relevance-has-judgements',
            'The relevance case has a judgement set to score against',
            'No judgement was supplied, so any retrieval score would be a green signal over an empty query set',
            { judgements: 0 },
          ),
        ],
        rates: [],
      };
    }

    const invariants: InvariantResult[] = [];
    const rates: RateResult[] = [];

    for (const judgement of judgements) {
      const topK = judgement.topK ?? DEFAULT_TOP_K;
      const result = await context.browse({ query: judgement.query, page: 1, pageSize: topK });
      const rows = servedRows(result);
      const servedTotal = result.estimatedTotalHits ?? rows.length;

      invariants.push(
        checkNotDegraded(
          `query-is-not-degraded:${judgement.query}`,
          `A search for "${judgement.query}" does not fall back to a degraded search path`,
          result.degraded,
        ),
      );

      if (judgement.expectNoResults) {
        invariants.push(checkExpectedNoResults(judgement.query, servedTotal));
        continue;
      }

      const matchers = judgement.relevantWhen ?? {};
      const score = scoreQueryRelevance(
        judgement.query,
        rows.map((row) => isRelevant(row, matchers)),
        topK,
        servedTotal,
      );
      invariants.push(checkQueryRelevance(score, judgement.minRelevant ?? topK));
      rates.push(
        buildRate(
          `precision-at-${topK}:${judgement.query}`,
          `Relevant results in the top ${topK} for "${judgement.query}"`,
          score.relevant,
          score.judged,
        ),
      );
    }

    return { invariants, rates, notes: { judgementsScored: judgements.length } };
  },
};

const WALK_PAGE_SIZE = 100;

const walkServedCorpus = async (context: JourneyEvalContext) => {
  const reachablePages = maxReachableResearchSearchPage(WALK_PAGE_SIZE);
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let estimatedTotalHits = 0;
  let degradedPages = 0;
  for (let page = 1; page <= reachablePages; page += 1) {
    const result = await context.browse({ page, pageSize: WALK_PAGE_SIZE });
    estimatedTotalHits = result.estimatedTotalHits ?? estimatedTotalHits;
    if (result.degraded !== false) degradedPages += 1;
    const pageRows = servedRows(result);
    for (const row of pageRows) {
      const key = rowKey(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (pageRows.length < WALK_PAGE_SIZE) break;
  }
  return { rows, estimatedTotalHits, degradedPages };
};

const storedQuoteProvenance = (
  storedRow: Record<string, unknown> | undefined,
): { sourceName: string; sourceUrl: string } => {
  const provenance = (storedRow?.fieldProvenance as Record<string, unknown> | undefined)
    ?.undergradEvidenceQuote as Record<string, unknown> | undefined;
  return {
    sourceName: typeof provenance?.sourceName === 'string' ? provenance.sourceName : '',
    sourceUrl: typeof provenance?.sourceUrl === 'string' ? provenance.sourceUrl : '',
  };
};

const undergradEvidenceQuotePrecision: JourneyCase = {
  id: 'undergrad-evidence-quote-precision',
  title:
    'A served undergraduate evidence quote is grounded on its cited page and states an access fact',
  run: async (context) => {
    const judgementSet = context.undergradEvidenceJudgements ?? null;
    const lane = judgementSet?.lane ?? DEFAULT_UNDERGRAD_EVIDENCE_LANE;
    const corpusBefore = await context.readCorpusFingerprint();
    const walk = await walkServedCorpus(context);
    const quoted = walk.rows.filter((row) => hasText(row.undergradEvidenceQuote));
    const stored = await context.readStoredRows(quoted.map(rowKey));
    const corpusAfter = await context.readCorpusFingerprint();

    const attribution: QuoteAttributionObservation[] = [];
    const laneRows: Array<{ row: Record<string, unknown>; sourceUrl: string }> = [];
    let citingAPage = 0;
    let skippedStaleIndex = 0;
    for (const row of quoted) {
      const storedRow = stored.get(rowKey(row));
      const provenance = storedQuoteProvenance(storedRow);
      const servedVersionMatchesStored =
        Boolean(storedRow) && storedRow?.undergradEvidenceQuote === row.undergradEvidenceQuote;
      attribution.push({ servedVersionMatchesStored, storedSourceName: provenance.sourceName });
      if (!servedVersionMatchesStored) {
        skippedStaleIndex += 1;
        continue;
      }
      if (provenance.sourceUrl) citingAPage += 1;
      if (provenance.sourceName === lane) laneRows.push({ row, sourceUrl: provenance.sourceUrl });
    }

    const population: UndergradEvidenceServedRow[] = laneRows.map(({ row }) => ({
      rowKey: rowKey(row),
      quoteFingerprint: fingerprintQuote(row.undergradEvidenceQuote as string),
    }));
    const populationFingerprint = fingerprintPopulation(population.map((row) => row.rowKey));

    const invariants: InvariantResult[] = [
      checkUndergradEvidenceQuoteAttribution(attribution, corpusBefore, corpusAfter),
      buildInvariant(
        'undergrad-evidence-walk-is-not-degraded',
        'The corpus walk behind the precision sample never falls back to a degraded search path',
        walk.degradedPages === 0,
        { degradedPages: walk.degradedPages },
      ),
    ];
    const rates: RateResult[] = [
      buildRate(
        'served-cards-with-an-undergrad-evidence-quote',
        'Served rows carrying a non-empty undergraduate evidence quote',
        quoted.length,
        walk.rows.length,
      ),
      buildRate(
        'undergrad-evidence-quotes-from-the-judged-lane',
        `Served undergraduate evidence quotes matching their stored row whose provenance is ${lane}`,
        laneRows.length,
        quoted.length - skippedStaleIndex,
      ),
      buildRate(
        'undergrad-evidence-quotes-citing-a-page',
        'Served undergraduate evidence quotes matching their stored row whose provenance cites a source page',
        citingAPage,
        quoted.length - skippedStaleIndex,
      ),
    ];
    const notes: Record<string, unknown> = {
      lane,
      servedRowsWalked: walk.rows.length,
      estimatedTotalHits: walk.estimatedTotalHits,
      population: population.length,
      skippedStaleIndex,
      populationFingerprint,
      corpusMovedDuringWalk: corpusFingerprintMoved(corpusBefore, corpusAfter),
    };

    const sampleRequest = context.undergradEvidenceSampleRequest;
    if (sampleRequest) {
      const drawn = new Set(
        drawSeededSample(
          population.map((row) => row.rowKey),
          sampleRequest.seed,
          sampleRequest.sampleSize,
        ),
      );
      const sampleRows = laneRows.filter(({ row }) => drawn.has(rowKey(row)));
      notes.sampleWrittenTo = await sampleRequest.write({
        lane,
        seed: sampleRequest.seed,
        sampleSize: sampleRequest.sampleSize,
        judgements: sampleRows.map(({ row, sourceUrl }) => ({
          rowKey: rowKey(row),
          quoteFingerprint: fingerprintQuote(row.undergradEvidenceQuote as string),
          quote: row.undergradEvidenceQuote as string,
          sourceUrl,
        })),
      });
    }

    if (!judgementSet) {
      invariants.push(
        buildInconclusiveInvariant(
          'undergrad-evidence-precision-has-judgements',
          'The precision case has a judgement set to score against',
          'No judgement file was supplied, so a precision over it would be a green signal over an empty sample',
          { judgements: 0 },
        ),
      );
      return { invariants, rates, notes };
    }

    const score = scoreUndergradEvidenceJudgements(
      population,
      judgementSet.judgements,
      judgementSet.seed,
      judgementSet.sampleSize,
    );
    if (score.verifiable === 0) {
      invariants.push(
        buildInconclusiveInvariant(
          'undergrad-evidence-precision-has-judgements',
          'The precision case has a judgement set to score against',
          'No drawn row carries a verdict on its current quote, so a precision over it would be a green signal over an empty sample',
          {
            drawn: score.drawn,
            unjudged: score.unjudged,
            changed: score.judgementForAChangedQuote,
          },
        ),
      );
    }
    rates.push(
      buildRate(
        'undergrad-evidence-badge-precision',
        'Readable judged quotes that are grounded, about the row, and state an undergraduate access fact',
        score.correct,
        score.verifiable,
      ),
      buildRate(
        'undergrad-evidence-lane-grounding-precision',
        'Judged quotes that are correct among those judged correct or not grounded',
        score.correct,
        score.laneGroundingJudged,
      ),
      buildRate(
        'undergrad-evidence-backs-hosted-badge-wording',
        'Judged quotes that back the browse badge wording that the row has hosted undergraduate researchers',
        score.badgeWordingBacked,
        score.badgeWordingJudged,
      ),
    );
    notes.score = { seed: judgementSet.seed, sampleSize: judgementSet.sampleSize, ...score };
    return { invariants, rates, notes };
  },
};

export const journeyCases: readonly JourneyCase[] = [
  coldBrowseCardContract,
  topicDropAttribution,
  facetCountAgreement,
  paginationServesDistinctRows,
  sortedBrowseKeepsOrder,
  topicQueryRelevance,
  undergradEvidenceQuotePrecision,
];
