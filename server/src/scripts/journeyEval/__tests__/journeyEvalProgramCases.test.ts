import { describe, expect, it } from 'vitest';
import {
  CLIENT_PROGRAM_PAGE_SIZE,
  PROGRAMS_SURFACE,
  programSurfaceCases,
  rowCarriesFilterValue,
  walkProgramBrowseLikeTheClient,
  type ProgramBrowseRequest,
  type ProgramJourneyContext,
} from '../journeyEvalProgramCases';
import { fellowshipJourneyCases } from '../journeyEvalFellowshipCases';
import { studentProgramSearchQuery } from '../programJourneyContext';
import { publicFellowshipForStudent } from '../../../services/fellowshipService';

const steadyFingerprint = { rowCount: 3, latestUpdatedAt: '2026-09-01T00:00:00.000Z' };

const syntheticRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    _id: `row-${String(index).padStart(4, '0')}`,
    title: `Synthetic Program ${String(index).padStart(4, '0')}`,
    programCategory: index % 2 === 0 ? 'FELLOWSHIP' : 'RECURRING_PROGRAM',
  }));

const fakeContext = (
  rows: Array<Record<string, unknown>>,
  pageOverride?: (request: ProgramBrowseRequest) => Array<Record<string, unknown>> | undefined,
): ProgramJourneyContext => ({
  browseAsStudent: async (request) => {
    const scoped = rows.filter((row) =>
      Object.entries(request.filters ?? {}).every(([field, values]) =>
        values.some((value) => rowCarriesFilterValue(row, field, value)),
      ),
    );
    const pageSize = request.pageSize ?? 20;
    const page = request.page ?? 1;
    const results = pageOverride?.(request) ?? scoped.slice((page - 1) * pageSize, page * pageSize);
    return {
      results,
      total: scoped.length,
      page,
      pageSize,
      totalPages: Math.ceil(scoped.length / pageSize),
    };
  },
  readFilterOptions: async () => ({}),
  readStoredPrograms: async () => new Map(),
  readCorpusFingerprint: async () => steadyFingerprint,
  window: 100,
  pagesChecked: 3,
  facetValuesChecked: 3,
});

describe('walkProgramBrowseLikeTheClient', () => {
  it('stops after the short last page the way the browse client does', async () => {
    const walk = await walkProgramBrowseLikeTheClient(fakeContext(syntheticRows(250)), {});

    expect(walk.pages.map((page) => page.length)).toEqual([
      CLIENT_PROGRAM_PAGE_SIZE,
      CLIENT_PROGRAM_PAGE_SIZE,
      50,
    ]);
    expect(walk.rows).toHaveLength(250);
  });
});

describe('full walk case', () => {
  it('fails when a page repeats a row so the walk misses one', async () => {
    const rows = syntheticRows(150);
    const context = fakeContext(rows, (request) =>
      request.page === 2 ? [rows[0], ...rows.slice(101, 150)] : undefined,
    );
    const fullWalk = programSurfaceCases({
      id: 'programs',
      label: 'Programs',
      filters: {},
      offersEveryFilterOption: true,
    }).find((journeyCase) => journeyCase.id === 'programs-full-walk-serves-every-row-once');
    const outcome = await fullWalk!.run(context);
    const statusById = Object.fromEntries(
      outcome.invariants.map((invariant) => [invariant.id, invariant.status]),
    );

    expect(statusById['programs-no-row-repeats-across-pages']).toBe('fail');
    expect(statusById['programs-full-walk-serves-the-reported-total']).toBe('fail');
  });
});

describe('deadline cases over the serve path', () => {
  const recurringFields = {
    summary: 'An annual summer research fellowship with a stipend.',
    applicationLink: 'https://apply.example.edu/programs/synthetic',
    programCategory: 'FELLOWSHIP',
    isAcceptingApplications: true,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const storedInSortOrder = [
    {
      ...recurringFields,
      _id: 'row-date-only',
      title: 'Synthetic Program A',
      deadline: new Date('2026-12-01T23:59:59.999Z'),
    },
    {
      ...recurringFields,
      _id: 'row-stated-time',
      title: 'Synthetic Program B',
      deadline: new Date('2026-12-02T02:00:00.000Z'),
    },
  ];
  const servedContext = (): ProgramJourneyContext => ({
    ...fakeContext(storedInSortOrder.map((row) => publicFellowshipForStudent(row))),
    readStoredPrograms: async (ids) =>
      new Map(
        storedInSortOrder
          .filter((row) => ids.includes(row._id))
          .map((row) => [row._id, row as Record<string, unknown>]),
      ),
  });
  const statusOf = async (caseId: string, invariantId: string) => {
    const journeyCase = programSurfaceCases(PROGRAMS_SURFACE).find(
      (candidate) => candidate.id === caseId,
    );
    const outcome = await journeyCase!.run(servedContext());
    return outcome.invariants.find((invariant) => invariant.id === invariantId)?.status;
  };

  it('passes the default sort when a date-only close moves a served deadline past its stored successor', async () => {
    const served = storedInSortOrder.map((row) => publicFellowshipForStudent(row));
    expect(served[0].deadline.getTime()).toBeGreaterThan(served[1].deadline.getTime());

    expect(
      await statusOf(
        'programs-sorted-browse-keeps-order',
        'programs-default-sort-orders-by-stored-deadline',
      ),
    ).toBe('pass');
  });

  it('attributes every served deadline the serve path produced', async () => {
    expect(
      await statusOf(
        'programs-served-field-difference-attribution',
        'programs-every-served-field-difference-is-attributable',
      ),
    ).toBe('pass');
  });
});

describe('fellowship surface', () => {
  it('scopes every browse to the fellowship category and checks it is honored', async () => {
    const coldBrowse = fellowshipJourneyCases.find(
      (journeyCase) => journeyCase.id === 'fellowships-cold-browse-card-contract',
    );
    const outcome = await coldBrowse!.run(fakeContext(syntheticRows(10)));
    const scope = outcome.invariants.find(
      (invariant) => invariant.id === 'fellowships-surface-scope-is-honored',
    );

    expect(scope?.status).toBe('pass');
    expect(scope?.detail.rowsChecked).toBe(5);
  });

  it('fails every walk-based case when a later page serves a row outside the category', async () => {
    const rows = syntheticRows(300);
    const fellowships = rows.filter((row) => row.programCategory === 'FELLOWSHIP');
    const outsideCategory = rows.find((row) => row.programCategory !== 'FELLOWSHIP')!;
    const context = fakeContext(rows, (request) =>
      request.page === 2 ? [outsideCategory, ...fellowships.slice(101, 150)] : undefined,
    );

    const walkingCases = fellowshipJourneyCases.filter(
      (journeyCase) =>
        journeyCase.id !== 'fellowships-cold-browse-card-contract' &&
        journeyCase.id !== 'fellowships-filter-options-agree-with-filtered-browse',
    );
    for (const journeyCase of walkingCases) {
      const outcome = await journeyCase.run(context);
      const scope = outcome.invariants.find(
        (invariant) => invariant.id === 'fellowships-surface-scope-is-honored',
      );
      expect({ id: journeyCase.id, status: scope?.status }).toEqual({
        id: journeyCase.id,
        status: 'fail',
      });
    }
  });

  it('prefixes every case with its surface so ids never collide with the programs surface', () => {
    expect(
      fellowshipJourneyCases.every((journeyCase) => journeyCase.id.startsWith('fellowships-')),
    ).toBe(true);
  });
});

describe('studentProgramSearchQuery', () => {
  it('encodes filters the way the browse client joins them', () => {
    expect(
      studentProgramSearchQuery(
        {
          page: 2,
          pageSize: 50,
          sortBy: 'title',
          sortOrder: 1,
          filters: { programCategory: ['FELLOWSHIP'], yearOfStudy: ['Junior', 'Senior'] },
        },
        100,
      ),
    ).toEqual({
      query: '',
      page: '2',
      pageSize: '50',
      sortBy: 'title',
      sortOrder: '1',
      programCategory: 'FELLOWSHIP',
      yearOfStudy: 'Junior,Senior',
    });
  });
});
