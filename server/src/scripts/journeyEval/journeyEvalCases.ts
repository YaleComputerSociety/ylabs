import { dropDomainIncoherentUnsourcedResearchAreas } from '../../utils/researchAreaDomainCoherence';
import { normalizeResearchAreaList } from '../../utils/researchAreaHygiene';
import {
  attributeTopicDrops,
  buildRate,
  checkFacetAgreement,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkSortOrdering,
  type FacetAgreementObservation,
  type InvariantResult,
  type RateResult,
  type TopicDropObservation,
} from './journeyEvalMetrics';

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

export interface JourneyEvalContext {
  browse: BrowseFn;
  readStoredRows: ReadStoredRowsFn;
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

const numericTimestamp = (value: unknown): number | null => {
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
        {
          id: 'cold-browse-serves-facets',
          title: 'A cold browse returns a facet distribution the filter rail can render',
          passed: facetKeys.length > 0,
          detail: { facetKeys },
        },
        {
          id: 'cold-browse-fills-the-page',
          title: 'A cold browse fills the requested page when the corpus is larger than it',
          passed:
            rows.length === context.window || (result.estimatedTotalHits ?? 0) < context.window,
          detail: {
            requested: context.window,
            served: rows.length,
            total: result.estimatedTotalHits,
          },
        },
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
      });
    }

    const tally = attributeTopicDrops(observations);

    return {
      invariants: [
        {
          id: 'every-topic-drop-is-attributable',
          title: 'No browse card withholds a topic the coherence guard does not account for',
          passed: tally.unexplained === 0,
          detail: { ...tally },
        },
        {
          id: 'serving-no-topic-is-attributable',
          title: 'A card serving no topic while storing some is fully accounted for by the guard',
          passed: tally.servedNoneUnexplained === 0,
          detail: {
            servedNoneWhileStoringSome: tally.servedNoneWhileStoringSome,
            servedNoneUnexplained: tally.servedNoneUnexplained,
          },
        },
      ],
      rates: [
        buildRate(
          'topic-drops-attributed-to-the-guard',
          'Topic drops the coherence guard accounts for',
          tally.attributedToGuard,
          tally.dropped,
        ),
      ],
      notes: { comparedRows: observations.length },
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
    const degradedChecks: InvariantResult[] = [];
    for (const [value, facetCount] of topValues) {
      const filtered = await context.browse({
        filters: { departments: [value] },
        page: 1,
        pageSize: 1,
      });
      observations.push({
        value,
        facetCount,
        filteredTotal: filtered.estimatedTotalHits ?? -1,
      });
      degradedChecks.push(
        checkNotDegraded(
          'filtered-browse-is-not-degraded',
          'A browse filtered to one facet value does not fall back to a degraded search path',
          filtered.degraded,
        ),
      );
    }

    const anyDegraded = degradedChecks.find((check) => !check.passed);

    return {
      invariants: [
        checkFacetAgreement(observations),
        anyDegraded ?? {
          id: 'filtered-browse-is-not-degraded',
          title:
            'A browse filtered to one facet value does not fall back to a degraded search path',
          passed: true,
          detail: { checked: degradedChecks.length },
        },
      ],
      rates: [],
    };
  },
};

const paginationServesDistinctRows: JourneyCase = {
  id: 'pagination-serves-distinct-rows',
  title: 'Paging through browse never serves the same row twice',
  run: async (context) => {
    const pages: string[][] = [];
    for (let page = 1; page <= context.pagesChecked; page += 1) {
      const result = await context.browse({ page, pageSize: context.window });
      pages.push(servedRows(result).map(rowKey).filter(Boolean));
    }

    return {
      invariants: [checkNoRepeatedRowsAcrossPages(pages)],
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
          rows.map((row) => numericTimestamp(row.lastObservedAt)),
          'desc',
        ),
      ],
      rates: [],
    };
  },
};

export const journeyCases: readonly JourneyCase[] = [
  coldBrowseCardContract,
  topicDropAttribution,
  facetCountAgreement,
  paginationServesDistinctRows,
  sortedBrowseKeepsOrder,
];
