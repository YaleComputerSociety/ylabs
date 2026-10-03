import {
  decideServedResearchEntityCreativePractice,
  decideServedResearchEntityTopics,
  researchEntityListServedSource,
} from '../../services/researchEntityDto';
import { unattributedResearchAreaDrops } from '../../utils/servedResearchAreaGuards';
import { maxReachableResearchSearchPage } from '../../services/researchSearchPagination';
import { researchEntitySortTitle } from '../../utils/servedResearchEntityTitle';
import {
  buildResearchEntitySearchIndexDocument,
  MESH_DESCRIPTOR_ONLY_TERMS_FIELD,
} from '../../services/researchEntitySearchIndexService';
import { meshDescriptorWordKeys } from '../../scrapers/utils/meshNonSubjectDescriptors';
import {
  attributeTopicDrops,
  buildInconclusiveInvariant,
  buildInvariant,
  buildRate,
  checkExpectedNoResults,
  checkFacetAgreement,
  checkConstantReportedTotal,
  checkCreativePracticeLabelAttribution,
  checkDefaultBrowseOrderIsRepeatable,
  checkMeshDescriptorOnlyRowsRankBelowOwnEvidence,
  checkQueryVariantServesTheBaseline,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkQueryRelevance,
  checkSortOrdering,
  checkSurvivorWebsiteAttribution,
  checkTitleSortOrdering,
  checkTopicDropAttribution,
  checkUndergradEvidenceQuoteAttribution,
  corpusFingerprintMoved,
  drawSeededSample,
  fingerprintPopulation,
  fingerprintQuote,
  resolvePagesToWalk,
  scoreQueryRelevance,
  scoreUndergradEvidenceJudgements,
  tallyCreativePracticeLabels,
  tallySurvivorWebsites,
  type CorpusFingerprint,
  type CreativePracticeLabelObservation,
  type FacetAgreementObservation,
  type InvariantResult,
  type QueryEvidenceClass,
  type RateResult,
  type QuoteAttributionObservation,
  type SurvivorWebsiteObservation,
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

export interface LeadMemberNameRead {
  byEntityId: ReadonlyMap<string, readonly string[]>;
  unavailable: boolean;
}

export type ReadLeadMemberNamesFn = (
  storedRows: Array<Record<string, unknown>>,
) => Promise<LeadMemberNameRead>;

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
  readLeadMemberNames?: ReadLeadMemberNamesFn;
  readCorpusFingerprint: () => Promise<CorpusFingerprint>;
  readOwnedSlotSurvivorWebsites: () => Promise<{
    survivorsScanned: number;
    observations: SurvivorWebsiteObservation[];
  }>;
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

const inlineText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Whether a browse card carries a line other than the row's own served card.
 *
 * One resolver owns the card a student reads, so a list payload may serve that line or
 * the named limited-description state and nothing else. Browse used to resolve its own
 * summary from the stored short and body, which put the whole body in the card slot
 * whenever the sanitized short was empty, so a row could be cleared by the visibility
 * gate on one line while browse showed a second (#3747). This is an invariant rather
 * than a rate: it is a property of the serving code and does not move when the corpus
 * does.
 */
const browseCardIsNotTheServedCard = (row: Record<string, unknown>): boolean => {
  const card = row.cardDescription as { text?: unknown; state?: unknown } | undefined | null;
  if (!card || typeof card !== 'object') return true;
  if (card.state === 'sparse') return false;
  return inlineText(card.text) !== inlineText(row.shortDescription);
};

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
        buildInvariant(
          'browse-card-is-the-served-card',
          "Every browse card serves the row's own served card or the named limited state",
          rows.filter(browseCardIsNotTheServedCard).length === 0,
          {
            rowsChecked: rows.length,
            divergentCards: rows.filter(browseCardIsNotTheServedCard).length,
          },
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
  title: 'Every topic a browse card withholds is attributable to the served topic guards',
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const result = await context.browse({ page: 1, pageSize: context.window });
    const rows = servedRows(result);
    const stored = await context.readStoredRows(rows.map(rowKey).filter(Boolean));
    const leadNames = context.readLeadMemberNames
      ? await context.readLeadMemberNames([...stored.values()])
      : { byEntityId: new Map<string, readonly string[]>(), unavailable: false };

    const observations: TopicDropObservation[] = [];
    for (const row of rows) {
      const storedRow = stored.get(rowKey(row));
      if (!storedRow) continue;
      const leadMemberNames = leadNames.byEntityId.get(String(storedRow._id ?? ''));
      const decision = decideServedResearchEntityTopics(
        researchEntityListServedSource(storedRow, leadMemberNames, leadNames.unavailable),
        leadMemberNames,
      );
      const served = Array.isArray(row.researchAreas) ? row.researchAreas : [];
      const storedAreas = Array.isArray(storedRow.researchAreas) ? storedRow.researchAreas : [];
      observations.push({
        storedCount: storedAreas.length,
        servedCount: served.length,
        explainedByDecision:
          served.length === decision.served.length &&
          served.every((area, index) => area === decision.served[index]) &&
          unattributedResearchAreaDrops(storedAreas, decision).length === 0,
        withheldBy: decision.withheld.map((withheld) => withheld.guard),
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
          'A card serving no topic while storing some is fully accounted for by the served topic guards',
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
          'Topic drops the served topic guards account for',
          tally.attributedToGuard,
          tally.dropped,
        ),
      ],
      notes: { comparedRows: tally.comparable, skippedStaleIndex: tally.skippedStaleIndex },
    };
  },
};

const creativePracticeLabelAttribution: JourneyCase = {
  id: 'creative-practice-label-attribution',
  title: 'The creative practice label on a browse card is the served-copy decision',
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const result = await context.browse({ page: 1, pageSize: context.window });
    const rows = servedRows(result);
    const stored = await context.readStoredRows(rows.map(rowKey).filter(Boolean));
    const leadNames = context.readLeadMemberNames
      ? await context.readLeadMemberNames([...stored.values()])
      : { byEntityId: new Map<string, readonly string[]>(), unavailable: false };

    const observations: CreativePracticeLabelObservation[] = [];
    for (const row of rows) {
      const storedRow = stored.get(rowKey(row));
      if (!storedRow) continue;
      const leadMemberNames = leadNames.byEntityId.get(String(storedRow._id ?? ''));
      const decision = decideServedResearchEntityCreativePractice(
        researchEntityListServedSource(storedRow, leadMemberNames, leadNames.unavailable),
        leadMemberNames,
      );
      observations.push({
        served: row.creativePractice === true,
        decided: decision.creativePractice,
        servedVersionMatchesStored:
          epochMillis(row.lastObservedAt) === epochMillis(storedRow.lastObservedAt),
      });
    }

    const tally = tallyCreativePracticeLabels(observations);
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [checkCreativePracticeLabelAttribution(tally, corpusBefore, corpusAfter)],
      rates: [
        buildRate(
          'browse-cards-labelled-creative-practice',
          'Browse cards labelled creative practice',
          tally.labelled,
          tally.comparable,
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

const defaultBrowseOrderIsRepeatable: JourneyCase = {
  id: 'default-browse-order-is-repeatable',
  title: 'The default browse serves one fixed order a student can page through and come back to',
  run: async (context) => {
    const reachablePages = maxReachableResearchSearchPage(context.window);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, reachablePages);
    const corpusBefore = await context.readCorpusFingerprint();
    const walk = async () => {
      const pages: string[][] = [];
      let degradedPages = 0;
      for (let page = 1; page <= pagesToWalk; page += 1) {
        const result = await context.browse({ page, pageSize: context.window });
        if (result.degraded !== false) degradedPages += 1;
        pages.push(servedRows(result).map(rowKey).filter(Boolean));
      }
      return { pages, degradedPages };
    };
    const firstWalk = await walk();
    const secondWalk = await walk();
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        buildInvariant(
          'default-browse-is-not-degraded',
          'The default browse does not fall back to the observation-time tiebreak',
          firstWalk.degradedPages + secondWalk.degradedPages === 0,
          {
            pagesWalked: pagesToWalk,
            degradedPages: firstWalk.degradedPages + secondWalk.degradedPages,
          },
        ),
        checkDefaultBrowseOrderIsRepeatable(
          firstWalk.pages,
          secondWalk.pages,
          corpusBefore,
          corpusAfter,
        ),
        checkNoRepeatedRowsAcrossPages(firstWalk.pages, corpusBefore, corpusAfter, {
          pagesRequested: context.pagesChecked,
          reachablePages,
        }),
      ],
      rates: [],
    };
  },
};

const TEXT_QUERY_TOTAL_PROBE = 'cancers';

const textQueryTotalIsStable: JourneyCase = {
  id: 'text-query-total-is-stable',
  title: 'A text query reports the same total however far the student has scrolled',
  run: async (context) => {
    const reachablePages = maxReachableResearchSearchPage(context.window);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, reachablePages);
    const corpusBefore = await context.readCorpusFingerprint();
    const totals: (number | null)[] = [];
    for (let page = 1; page <= pagesToWalk; page += 1) {
      const result = await context.browse({
        query: TEXT_QUERY_TOTAL_PROBE,
        page,
        pageSize: context.window,
      });
      totals.push(typeof result.estimatedTotalHits === 'number' ? result.estimatedTotalHits : null);
      if (servedRows(result).length < context.window) break;
    }
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        checkConstantReportedTotal(TEXT_QUERY_TOTAL_PROBE, totals, corpusBefore, corpusAfter),
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

const titleSortedBrowseFollowsCardTitle: JourneyCase = {
  id: 'title-sorted-browse-follows-card-title',
  title: 'A browse sorted A-Z is ordered by the title each card shows',
  run: async (context) => {
    const reachablePages = maxReachableResearchSearchPage(context.window);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, reachablePages);
    const corpusBefore = await context.readCorpusFingerprint();
    const sortTitles: string[] = [];
    let degradedPages = 0;
    for (let page = 1; page <= pagesToWalk; page += 1) {
      const result = await context.browse({
        page,
        pageSize: context.window,
        sort: { sortBy: 'name', sortOrder: 'asc' },
      });
      if (result.degraded !== false) degradedPages += 1;
      sortTitles.push(...servedRows(result).map((row) => researchEntitySortTitle(row)));
    }
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        buildInvariant(
          'title-sorted-browse-is-not-degraded',
          'An A-Z browse does not fall back to sorting by a field the card does not show',
          degradedPages === 0,
          { pagesWalked: pagesToWalk, degradedPages },
        ),
        checkTitleSortOrdering(sortTitles, 'asc', corpusBefore, corpusAfter),
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
        'Readable judged quotes found verbatim or near-verbatim on their cited page',
        score.grounded,
        score.verifiable,
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

const survivorWebsiteAttribution: JourneyCase = {
  id: 'survivor-website-attribution',
  title:
    "A served merged survivor whose own lab-identity lane owns its website does not serve a loser's",
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const { survivorsScanned, observations } = await context.readOwnedSlotSurvivorWebsites();
    const tally = tallySurvivorWebsites(observations);
    const corpusAfter = await context.readCorpusFingerprint();
    const traced = tally.byAttribution['survivor-evidence'] + tally.byAttribution.locked;

    return {
      invariants: [checkSurvivorWebsiteAttribution(tally, corpusBefore, corpusAfter)],
      rates: [
        buildRate(
          'survivor-websites-traced-to-evidence',
          'Owned-slot survivor websites traced to survivor evidence or a lock',
          traced,
          tally.comparable,
        ),
      ],
      notes: {
        servedSurvivorsWithAWebsite: survivorsScanned,
        survivorsWhoseOwnLaneOwnsTheWebsite: observations.length,
        ...tally.byAttribution,
      },
    };
  },
};

const INSTITUTION_WORD_QUERY_PAIRS = [
  { baselineQuery: 'machine learning', variantQuery: 'machine learning research at yale' },
  { baselineQuery: 'robotics', variantQuery: 'robotics research at yale' },
  { baselineQuery: 'neuroscience', variantQuery: 'yale university neuroscience' },
];
const QUERY_PAIR_DEPTH = 10;

const institutionWordKeepsTopicRanking: JourneyCase = {
  id: 'institution-word-keeps-topic-ranking',
  title: 'Adding the institution name to a topic query serves the same top rows as the topic',
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const servedKeys = async (query: string) =>
      servedRows(await context.browse({ query, pageSize: QUERY_PAIR_DEPTH }))
        .map(rowKey)
        .filter(Boolean);
    const pairs = [];
    for (const pair of INSTITUTION_WORD_QUERY_PAIRS) {
      pairs.push({
        ...pair,
        baselineKeys: await servedKeys(pair.baselineQuery),
        variantKeys: await servedKeys(pair.variantQuery),
      });
    }
    const corpusAfter = await context.readCorpusFingerprint();
    return {
      invariants: [
        checkQueryVariantServesTheBaseline(
          'institution-word-serves-the-topic-ranking',
          'A topic query with "yale" added serves the same ordered top rows as the topic alone',
          pairs,
          corpusBefore,
          corpusAfter,
        ),
      ],
      rates: [],
    };
  },
};

const MESH_DESCRIPTOR_PROBE_QUERIES = ['robotics', 'machine learning'];
const MESH_DESCRIPTOR_TOP_DEPTH = 10;
const MESH_DESCRIPTOR_POOL_DEPTH = 50;
const OWN_EVIDENCE_INDEX_FIELDS = [
  'name',
  'displayName',
  'shortDescription',
  'fullDescription',
  'departments',
  'orgAffiliationLabels',
  'methods',
];

const indexedWordKeys = (document: Record<string, unknown>, fields: string[]): Set<string> =>
  new Set(
    fields
      .flatMap((field) => {
        const value = document[field];
        return Array.isArray(value) ? value : [value];
      })
      .filter((value): value is string => typeof value === 'string')
      .flatMap(meshDescriptorWordKeys),
  );

const classifyQueryEvidence = (
  storedRow: Record<string, unknown> | undefined,
  queryKeys: readonly string[],
): QueryEvidenceClass => {
  const document = storedRow ? buildResearchEntitySearchIndexDocument(storedRow) : null;
  if (!document) return 'other';
  const descriptorOnlyTerms = document[MESH_DESCRIPTOR_ONLY_TERMS_FIELD];
  if (
    Array.isArray(descriptorOnlyTerms) &&
    queryKeys.some((key) => descriptorOnlyTerms.includes(key))
  ) {
    return 'meshDescriptorOnly';
  }
  const ownKeys = indexedWordKeys(document, OWN_EVIDENCE_INDEX_FIELDS);
  return queryKeys.every((key) => ownKeys.has(key)) ? 'ownEvidence' : 'other';
};

const meshDescriptorRanksBelowOwnEvidence: JourneyCase = {
  id: 'mesh-descriptor-ranks-below-own-evidence',
  title: "A MeSH technique descriptor never outranks a row's own evidence for the query",
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const rankings = [];
    for (const query of MESH_DESCRIPTOR_PROBE_QUERIES) {
      const keys = servedRows(await context.browse({ query, pageSize: MESH_DESCRIPTOR_POOL_DEPTH }))
        .map(rowKey)
        .filter(Boolean);
      const storedRows = await context.readStoredRows(keys);
      const queryKeys = meshDescriptorWordKeys(query);
      const classes = keys.map((key) => classifyQueryEvidence(storedRows.get(key), queryKeys));
      rankings.push({
        query,
        topClasses: classes.slice(0, MESH_DESCRIPTOR_TOP_DEPTH),
        meshDescriptorOnlyServed: classes.filter((evidence) => evidence === 'meshDescriptorOnly')
          .length,
      });
    }
    const corpusAfter = await context.readCorpusFingerprint();
    return {
      invariants: [
        checkMeshDescriptorOnlyRowsRankBelowOwnEvidence(rankings, corpusBefore, corpusAfter),
      ],
      rates: [],
    };
  },
};

export const journeyCases: readonly JourneyCase[] = [
  coldBrowseCardContract,
  topicDropAttribution,
  creativePracticeLabelAttribution,
  facetCountAgreement,
  paginationServesDistinctRows,
  textQueryTotalIsStable,
  sortedBrowseKeepsOrder,
  defaultBrowseOrderIsRepeatable,
  titleSortedBrowseFollowsCardTitle,
  topicQueryRelevance,
  undergradEvidenceQuotePrecision,
  survivorWebsiteAttribution,
  institutionWordKeepsTopicRanking,
  meshDescriptorRanksBelowOwnEvidence,
];
