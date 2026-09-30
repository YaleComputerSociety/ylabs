import { computeProgramStudentVisibility } from '../../services/studentVisibilityTier';
import { publicStudentVisibilityTiers } from '../../models/studentVisibility';
import {
  buildInconclusiveInvariant,
  buildInvariant,
  buildRate,
  checkConstantReportedTotal,
  checkNoRepeatedRowsAcrossPages,
  checkTitleSortOrdering,
  resolvePagesToWalk,
  type CorpusFingerprint,
  type InvariantResult,
  type RateResult,
} from './journeyEvalMetrics';
import {
  checkDeadlineSortOrder,
  checkFilteredRowsCarryValue,
  checkOfferedOptionsServeARow,
  checkProgramFieldAttribution,
  checkServedRowsAreInServedTier,
  checkServedRowsPassTheGate,
  checkWalkCoversReportedTotal,
  tallyProgramFieldAttribution,
  tallyServedRowGate,
  withSurfaceId,
  type FilterOptionObservation,
  type ProgramFieldRowObservation,
  type ServedRowGateObservation,
} from './journeyEvalProgramMetrics';
import { attributeProgramServedFields } from './programServedFieldAttribution';

export type ProgramFilters = Record<string, string[]>;

export interface ProgramBrowseRequest {
  query?: string;
  filters?: ProgramFilters;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 1 | -1;
}

export interface ProgramBrowseResult {
  results?: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

export interface ProgramJourneyContext {
  browseAsStudent: (request: ProgramBrowseRequest) => Promise<ProgramBrowseResult>;
  readFilterOptions: () => Promise<Record<string, string[]>>;
  readStoredPrograms: (ids: string[]) => Promise<Map<string, Record<string, unknown>>>;
  readCorpusFingerprint: () => Promise<CorpusFingerprint>;
  window: number;
  pagesChecked: number;
  facetValuesChecked: number;
}

export type ProgramSurfaceId = 'programs' | 'fellowships';

export interface ProgramSurface {
  id: ProgramSurfaceId;
  label: string;
  filters: ProgramFilters;
  offersEveryFilterOption: boolean;
}

export interface ProgramJourneyCase {
  id: string;
  title: string;
  surface: ProgramSurfaceId;
  run: (context: ProgramJourneyContext) => Promise<{
    invariants: InvariantResult[];
    rates: RateResult[];
    notes?: Record<string, unknown>;
  }>;
}

export const CLIENT_PROGRAM_PAGE_SIZE = 100;
export const MAX_PROGRAM_SEARCH_PAGE = 1000;
export const MAX_PROGRAM_SEARCH_PAGE_SIZE = 100;
const TEXT_QUERY_TOTAL_PROBE = 'research';

export const CORPUS_DERIVED_FILTER_FIELDS = [
  'programCategory',
  'programKind',
  'entryMode',
  'studentFacingCategory',
  'yearOfStudy',
  'termOfAward',
  'purpose',
  'globalRegions',
  'citizenshipStatus',
] as const;

const servedRows = (result: ProgramBrowseResult): Array<Record<string, unknown>> =>
  Array.isArray(result.results) ? result.results : [];

const rowKey = (row: Record<string, unknown>): string =>
  typeof row._id === 'string' ? row._id : typeof row.id === 'string' ? row.id : '';

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const epochMillis = (value: unknown): number | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

export const rowCarriesFilterValue = (
  row: Record<string, unknown>,
  field: string,
  value: string,
): boolean => {
  const served = row[field];
  return Array.isArray(served) ? served.includes(value) : served === value;
};

const rowMatchesFilters = (row: Record<string, unknown>, filters: ProgramFilters): boolean =>
  Object.entries(filters).every(([field, values]) =>
    values.some((value) => rowCarriesFilterValue(row, field, value)),
  );

const surfaceRequest = (
  surface: ProgramSurface,
  request: ProgramBrowseRequest,
): ProgramBrowseRequest => ({ ...request, filters: { ...surface.filters, ...request.filters } });

interface ProgramWalk {
  pages: string[][];
  rows: Array<Record<string, unknown>>;
  totals: (number | null)[];
  startedAt: Date;
  finishedAt: Date;
}

export async function walkProgramBrowseLikeTheClient(
  context: ProgramJourneyContext,
  request: ProgramBrowseRequest,
): Promise<ProgramWalk> {
  const startedAt = new Date();
  const pages: string[][] = [];
  const rows: Array<Record<string, unknown>> = [];
  const totals: (number | null)[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PROGRAM_SEARCH_PAGE; page += 1) {
    const result = await context.browseAsStudent({
      ...request,
      page,
      pageSize: CLIENT_PROGRAM_PAGE_SIZE,
    });
    const pageRows = servedRows(result);
    const reportedTotal = typeof result.total === 'number' ? result.total : null;
    totals.push(reportedTotal);
    pages.push(pageRows.map(rowKey).filter(Boolean));
    for (const row of pageRows) {
      const key = rowKey(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    const collected = pages.reduce((sum, keys) => sum + keys.length, 0);
    if (pageRows.length < CLIENT_PROGRAM_PAGE_SIZE) break;
    if (reportedTotal !== null && collected >= reportedTotal) break;
  }
  return { pages, rows, totals, startedAt, finishedAt: new Date() };
}

const storedVersionPredates = (stored: Record<string, unknown>, instant: Date): boolean => {
  const updatedAt = epochMillis(stored.updatedAt);
  return updatedAt !== null && updatedAt <= instant.getTime();
};

const coldBrowseCardContract = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-cold-browse-card-contract`,
  title: `A student opening the ${surface.label} browse with no query gets a full, well-formed page`,
  surface: surface.id,
  run: async (context) => {
    const requestedPageSize = Math.min(context.window, MAX_PROGRAM_SEARCH_PAGE_SIZE);
    const result = await context.browseAsStudent(
      surfaceRequest(surface, { page: 1, pageSize: context.window }),
    );
    const rows = servedRows(result);
    const total = typeof result.total === 'number' ? result.total : null;
    const invariants: InvariantResult[] = [];

    if (total === null || total === 0) {
      invariants.push(
        buildInconclusiveInvariant(
          `${surface.id}-cold-browse-fills-the-page`,
          'A cold browse fills the requested page when the corpus is larger than it',
          'The browse reported no rows, so a filled-page check over it would be a green signal over an empty population',
          { total },
        ),
      );
    } else {
      invariants.push(
        buildInvariant(
          `${surface.id}-cold-browse-fills-the-page`,
          'A cold browse fills the requested page when the corpus is larger than it',
          rows.length === Math.min(requestedPageSize, total),
          { requested: context.window, requestedPageSize, served: rows.length, total },
        ),
      );
    }
    invariants.push(
      buildInvariant(
        `${surface.id}-cold-browse-page-arithmetic`,
        'A cold browse reports the page, page size, and page count its total implies',
        result.page === 1 &&
          result.pageSize === requestedPageSize &&
          total !== null &&
          result.totalPages === Math.ceil(total / requestedPageSize),
        {
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
          total,
          requestedPageSize,
        },
      ),
      buildInvariant(
        `${surface.id}-cold-browse-rows-are-identified`,
        'Every served card carries the id the detail route and the saved-program list read',
        rows.every((row) => rowKey(row) !== ''),
        { rowsChecked: rows.length, unidentified: rows.filter((row) => !rowKey(row)).length },
      ),
    );
    if (Object.keys(surface.filters).length > 0) {
      invariants.push(
        buildInvariant(
          `${surface.id}-surface-scope-is-honored`,
          `Every row the ${surface.label} browse serves belongs to that surface`,
          rows.every((row) => rowMatchesFilters(row, surface.filters)),
          {
            rowsChecked: rows.length,
            outsideScope: rows.filter((row) => !rowMatchesFilters(row, surface.filters)).length,
          },
        ),
      );
    }

    return {
      invariants,
      rates: [
        buildRate(
          `${surface.id}-cards-with-a-deadline`,
          'Cards serving a deadline',
          rows.filter((row) => epochMillis(row.deadline) !== null).length,
          rows.length,
        ),
        buildRate(
          `${surface.id}-cards-with-a-projected-deadline`,
          'Cards serving a deadline projected to the next cycle',
          rows.filter((row) => row.deadlineProjectedNextCycle === true).length,
          rows.length,
        ),
        buildRate(
          `${surface.id}-cards-accepting-applications`,
          'Cards served as accepting applications',
          rows.filter((row) => row.isAcceptingApplications === true).length,
          rows.length,
        ),
        buildRate(
          `${surface.id}-cards-with-an-apply-link`,
          'Cards serving an apply link',
          rows.filter((row) => hasText(row.applicationLink)).length,
          rows.length,
        ),
        buildRate(
          `${surface.id}-cards-with-eligibility`,
          'Cards serving eligibility text',
          rows.filter((row) => hasText(row.eligibility)).length,
          rows.length,
        ),
        buildRate(
          `${surface.id}-cards-with-a-card-summary`,
          'Cards serving a card summary',
          rows.filter((row) => hasText(row.cardSummary)).length,
          rows.length,
        ),
      ],
    };
  },
});

const fullWalkServesEveryRowOnce = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-full-walk-serves-every-row-once`,
  title: `Loading the whole ${surface.label} browse page by page, as the client does, serves every row exactly once`,
  surface: surface.id,
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const walk = await walkProgramBrowseLikeTheClient(context, surfaceRequest(surface, {}));
    const corpusAfter = await context.readCorpusFingerprint();
    const lastTotal = walk.totals[walk.totals.length - 1] ?? null;

    return {
      invariants: [
        withSurfaceId(
          surface.id,
          checkNoRepeatedRowsAcrossPages(walk.pages, corpusBefore, corpusAfter),
        ),
        checkWalkCoversReportedTotal(
          surface.id,
          walk.rows.length,
          lastTotal,
          corpusBefore,
          corpusAfter,
        ),
        {
          ...checkConstantReportedTotal('', walk.totals, corpusBefore, corpusAfter),
          id: `${surface.id}-browse-total-is-constant-across-pages`,
          title: 'A cold browse reports the same total on every page the client loads',
        },
      ],
      rates: [],
      notes: {
        pagesWalked: walk.pages.length,
        rowsServed: walk.rows.length,
        reportedTotal: lastTotal,
      },
    };
  },
});

const textQueryTotalIsStable = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-text-query-total-is-stable`,
  title: `A text query on the ${surface.label} browse reports the same total on every page`,
  surface: surface.id,
  run: async (context) => {
    const pageSize = Math.min(context.window, MAX_PROGRAM_SEARCH_PAGE_SIZE);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, MAX_PROGRAM_SEARCH_PAGE);
    const corpusBefore = await context.readCorpusFingerprint();
    const totals: (number | null)[] = [];
    const pages: string[][] = [];
    for (let page = 1; page <= pagesToWalk; page += 1) {
      const result = await context.browseAsStudent(
        surfaceRequest(surface, { query: TEXT_QUERY_TOTAL_PROBE, page, pageSize }),
      );
      totals.push(typeof result.total === 'number' ? result.total : null);
      pages.push(servedRows(result).map(rowKey).filter(Boolean));
      if (servedRows(result).length < pageSize) break;
    }
    const corpusAfter = await context.readCorpusFingerprint();
    const repeats = withSurfaceId(
      surface.id,
      checkNoRepeatedRowsAcrossPages(pages, corpusBefore, corpusAfter, {
        pagesRequested: context.pagesChecked,
        reachablePages: MAX_PROGRAM_SEARCH_PAGE,
      }),
    );

    return {
      invariants: [
        withSurfaceId(
          surface.id,
          checkConstantReportedTotal(TEXT_QUERY_TOTAL_PROBE, totals, corpusBefore, corpusAfter),
        ),
        { ...repeats, id: `${repeats.id}-for-a-text-query` },
      ],
      rates: [],
    };
  },
});

const filterOptionsAgreeWithFilteredBrowse = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-filter-options-agree-with-filtered-browse`,
  title: `Each filter option the ${surface.label} browse offers returns rows that carry it`,
  surface: surface.id,
  run: async (context) => {
    const pageSize = Math.min(context.window, MAX_PROGRAM_SEARCH_PAGE_SIZE);
    const corpusBefore = await context.readCorpusFingerprint();
    const options = await context.readFilterOptions();
    const observations: FilterOptionObservation[] = [];
    const fields = CORPUS_DERIVED_FILTER_FIELDS.filter((field) => !(field in surface.filters));
    for (const field of fields) {
      for (const value of options[field] ?? []) {
        const result = await context.browseAsStudent(
          surfaceRequest(surface, { filters: { [field]: [value] }, page: 1, pageSize }),
        );
        const rows = servedRows(result);
        observations.push({
          field,
          value,
          filteredTotal: typeof result.total === 'number' ? result.total : 0,
          servedOnFirstPage: rows.length,
          servedCarryingValue: rows.filter((row) => rowCarriesFilterValue(row, field, value))
            .length,
        });
      }
    }
    const subjectTotals: number[] = [];
    for (const subject of options.subjects ?? []) {
      const result = await context.browseAsStudent(
        surfaceRequest(surface, { filters: { subjects: [subject] }, page: 1, pageSize: 1 }),
      );
      subjectTotals.push(typeof result.total === 'number' ? result.total : 0);
    }
    const corpusAfter = await context.readCorpusFingerprint();

    const topByField = fields.flatMap((field) =>
      observations
        .filter((observation) => observation.field === field)
        .sort((left, right) => right.filteredTotal - left.filteredTotal)
        .slice(0, context.facetValuesChecked),
    );
    const invariants: InvariantResult[] = [checkFilteredRowsCarryValue(surface.id, topByField)];
    if (surface.offersEveryFilterOption)
      invariants.push(
        checkOfferedOptionsServeARow(surface.id, observations, corpusBefore, corpusAfter),
      );

    return {
      invariants,
      rates: [
        buildRate(
          `${surface.id}-offered-filter-options-serving-a-row`,
          'Offered corpus-derived filter options that return at least one row',
          observations.filter((observation) => observation.filteredTotal > 0).length,
          observations.length,
        ),
        buildRate(
          `${surface.id}-subject-options-serving-a-row`,
          'Offered subject options that return at least one row',
          subjectTotals.filter((total) => total > 0).length,
          subjectTotals.length,
        ),
      ],
      notes: {
        optionsChecked: observations.length,
        optionsCheckedForCarriedValue: topByField.length,
        subjectsChecked: subjectTotals.length,
      },
    };
  },
});

const sortedBrowseKeepsOrder = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-sorted-browse-keeps-order`,
  title: `The ${surface.label} browse honors its default deadline order and a requested A-Z order`,
  surface: surface.id,
  run: async (context) => {
    const pageSize = Math.min(context.window, MAX_PROGRAM_SEARCH_PAGE_SIZE);
    const pagesToWalk = resolvePagesToWalk(context.pagesChecked, MAX_PROGRAM_SEARCH_PAGE);
    const corpusBefore = await context.readCorpusFingerprint();
    const defaultRows: Array<Record<string, unknown>> = [];
    const titleRows: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= pagesToWalk; page += 1) {
      const byDeadline = servedRows(
        await context.browseAsStudent(surfaceRequest(surface, { page, pageSize })),
      );
      const byTitle = servedRows(
        await context.browseAsStudent(
          surfaceRequest(surface, { page, pageSize, sortBy: 'title', sortOrder: 1 }),
        ),
      );
      defaultRows.push(...byDeadline);
      titleRows.push(...byTitle);
      if (byDeadline.length < pageSize && byTitle.length < pageSize) break;
    }
    const corpusAfter = await context.readCorpusFingerprint();

    return {
      invariants: [
        checkDeadlineSortOrder(
          surface.id,
          defaultRows.map((row) => ({
            deadlineMs: epochMillis(row.deadline),
            projectedNextCycle: row.deadlineProjectedNextCycle === true,
          })),
          corpusBefore,
          corpusAfter,
        ),
        withSurfaceId(
          surface.id,
          checkTitleSortOrdering(
            titleRows.map((row) => (typeof row.title === 'string' ? row.title : '')),
            'asc',
            corpusBefore,
            corpusAfter,
          ),
        ),
      ],
      rates: [
        buildRate(
          `${surface.id}-default-order-rows-projected-out-of-stored-order`,
          'Default-order rows whose served deadline is projected, so their card date differs from the date they are ordered by',
          defaultRows.filter((row) => row.deadlineProjectedNextCycle === true).length,
          defaultRows.length,
        ),
      ],
    };
  },
});

const servedRowsPassTheGate = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-served-rows-pass-the-visibility-gate`,
  title: `Every row the ${surface.label} browse serves is student-ready and admitted by the gate`,
  surface: surface.id,
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const walk = await walkProgramBrowseLikeTheClient(context, surfaceRequest(surface, {}));
    const stored = await context.readStoredPrograms(walk.rows.map(rowKey));
    const corpusAfter = await context.readCorpusFingerprint();

    const observations: ServedRowGateObservation[] = walk.rows.map((row) => {
      const storedRow = stored.get(rowKey(row));
      if (!storedRow)
        return {
          servedVersionMatchesStored: false,
          storedRowFound: false,
          storedTierIsServed: false,
          archived: false,
          gateTierIsServed: false,
          gateReasons: [],
        };
      const gate = computeProgramStudentVisibility(storedRow);
      return {
        servedVersionMatchesStored: storedVersionPredates(storedRow, walk.startedAt),
        storedRowFound: true,
        storedTierIsServed: publicStudentVisibilityTiers.includes(
          storedRow.studentVisibilityTier as never,
        ),
        archived: storedRow.archived === true,
        gateTierIsServed: publicStudentVisibilityTiers.includes(gate.tier),
        gateReasons: gate.reasons,
      };
    });
    const tally = tallyServedRowGate(observations);

    return {
      invariants: [
        checkServedRowsAreInServedTier(surface.id, tally, corpusBefore, corpusAfter),
        checkServedRowsPassTheGate(surface.id, tally, corpusBefore, corpusAfter),
      ],
      rates: [],
      notes: { servedRows: tally.servedRows, skippedStaleIndex: tally.skippedStaleIndex },
    };
  },
});

const servedFieldDifferenceAttribution = (surface: ProgramSurface): ProgramJourneyCase => ({
  id: `${surface.id}-served-field-difference-attribution`,
  title: `Every deadline, status, apply link, and eligibility difference on the ${surface.label} browse is a named guard's doing`,
  surface: surface.id,
  run: async (context) => {
    const corpusBefore = await context.readCorpusFingerprint();
    const walk = await walkProgramBrowseLikeTheClient(context, surfaceRequest(surface, {}));
    const stored = await context.readStoredPrograms(walk.rows.map(rowKey));
    const corpusAfter = await context.readCorpusFingerprint();

    const observations: ProgramFieldRowObservation[] = walk.rows.flatMap((row) => {
      const storedRow = stored.get(rowKey(row));
      if (!storedRow) return [];
      return [
        {
          servedVersionMatchesStored: storedVersionPredates(storedRow, walk.startedAt),
          outcomes: attributeProgramServedFields(storedRow, row, {
            from: walk.startedAt,
            to: walk.finishedAt,
          }),
        },
      ];
    });
    const tally = tallyProgramFieldAttribution(observations);
    const withStoredApplyLink = walk.rows.filter((row) =>
      hasText(stored.get(rowKey(row))?.applicationLink),
    ).length;
    const withStoredEligibility = walk.rows.filter((row) =>
      hasText(stored.get(rowKey(row))?.eligibility),
    ).length;
    const withStoredDeadline = walk.rows.filter(
      (row) => epochMillis(stored.get(rowKey(row))?.deadline) !== null,
    ).length;

    return {
      invariants: [checkProgramFieldAttribution(surface.id, tally, corpusBefore, corpusAfter)],
      rates: [
        buildRate(
          `${surface.id}-stored-deadlines-projected-to-next-cycle`,
          'Served rows storing a deadline whose served deadline is projected to the next cycle',
          tally.byField.deadline.byGuard.projectNextCycleDeadline ?? 0,
          withStoredDeadline,
        ),
        buildRate(
          `${surface.id}-stored-apply-links-withheld`,
          'Served rows storing an apply link whose served card withholds it',
          tally.byField.applicationLink.differing,
          withStoredApplyLink,
        ),
        buildRate(
          `${surface.id}-stored-eligibility-withheld`,
          'Served rows storing eligibility text whose served card withholds it',
          tally.byField.eligibility.differing,
          withStoredEligibility,
        ),
      ],
      notes: { comparedRows: tally.comparable, skippedStaleIndex: tally.skippedStaleIndex },
    };
  },
});

export const programSurfaceCases = (surface: ProgramSurface): ProgramJourneyCase[] => [
  coldBrowseCardContract(surface),
  fullWalkServesEveryRowOnce(surface),
  textQueryTotalIsStable(surface),
  filterOptionsAgreeWithFilteredBrowse(surface),
  sortedBrowseKeepsOrder(surface),
  servedRowsPassTheGate(surface),
  servedFieldDifferenceAttribution(surface),
];

export const PROGRAMS_SURFACE: ProgramSurface = {
  id: 'programs',
  label: 'Programs',
  filters: {},
  offersEveryFilterOption: true,
};

export const programJourneyCases: readonly ProgramJourneyCase[] =
  programSurfaceCases(PROGRAMS_SURFACE);
