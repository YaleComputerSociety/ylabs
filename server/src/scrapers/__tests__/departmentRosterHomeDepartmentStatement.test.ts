import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  type OrgUnitCanonicalizer,
} from '../orgUnitCanonicalization';
import {
  rosterHomeDepartmentStatement,
  type RosterTitleUnit,
} from '../rosterHomeDepartmentStatement';
import type { ObservationInput, ScraperContext } from '../types';

const DEPARTMENTS = ['Fixture Pathology', 'Fixture Urology', 'Internal Medicine'];

const statementFor = (deptName: string, title?: string, unit?: RosterTitleUnit) =>
  rosterHomeDepartmentStatement({
    deptName,
    title,
    departmentNames: DEPARTMENTS,
    classifyUnit: unit === undefined ? undefined : () => unit,
  });

describe('a department roster files its own department as primary only without contrary evidence (#6274)', () => {
  it('asserts the roster department when the title names it first', () => {
    expect(statementFor('Fixture Pathology', 'Professor of Fixture Pathology')).toEqual({
      kind: 'assert',
      value: 'Fixture Pathology',
    });
  });

  it('withholds when the title names another department first', () => {
    expect(
      statementFor('Fixture Pathology', 'Professor of Fixture Urology and of Fixture Pathology'),
    ).toEqual({ kind: 'withhold', reason: 'another-department-first' });
    expect(statementFor('Fixture Pathology', 'Associate Professor of Fixture Urology')).toEqual({
      kind: 'withhold',
      reason: 'another-department-first',
    });
  });

  it.each([
    ['secondary', 'Professor of Fixture Pathology (secondary appointment)'],
    ['joint', 'Professor of Fixture Pathology, joint appointment'],
    ['adjunct', 'Adjunct Professor of Fixture Pathology'],
    ['courtesy', 'Professor of Fixture Pathology by courtesy'],
    ['visiting', 'Visiting Professor of Fixture Pathology'],
  ])('withholds on the %s appointment marker', (reason, title) => {
    expect(statementFor('Fixture Pathology', title)).toEqual({ kind: 'withhold', reason });
  });

  it('states a section the catalog places under the roster department instead of the parent', () => {
    expect(
      statementFor('Internal Medicine', 'Professor of Medicine (Digestive Diseases)', {
        kind: 'section',
        value: 'Digestive Diseases',
      }),
    ).toEqual({ kind: 'assert', value: 'Digestive Diseases' });
  });

  it('withholds the parent when the catalog places the unit outside the roster department', () => {
    expect(
      statementFor('Internal Medicine', 'Professor of Medicine (Fixture Unit)', {
        kind: 'other-unit',
      }),
    ).toEqual({ kind: 'withhold', reason: 'unit-outside-this-department' });
  });

  it.each([
    ['a parenthetical the catalog does not hold as a unit', { kind: 'not-a-unit' } as const],
    ['a parenthetical read with no catalog', undefined],
  ])('still asserts the roster department for %s', (_shape, unit) => {
    expect(
      statementFor(
        'Fixture Pathology',
        'Professor of Fixture Pathology (On Leave Fall 2026)',
        unit,
      ),
    ).toEqual({ kind: 'assert', value: 'Fixture Pathology' });
  });

  it.each([
    ['no title', undefined],
    ['a blank title', '  '],
    ['a title naming no department', 'Research Scientist'],
  ])('still asserts the roster department on a page that states nothing: %s', (_shape, title) => {
    expect(statementFor('Fixture Pathology', title)).toEqual({
      kind: 'assert',
      value: 'Fixture Pathology',
    });
  });
});

describe('the roster lane emits the home department through that statement (#6274)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const config = (deptKey: string, deptName: string, people: FacultyEntry[]): DeptConfig => ({
    deptKey,
    deptName,
    schoolName: 'Yale School of Medicine',
    url: `https://${deptKey}.example.edu/people/`,
    paginated: false,
    extractor: () => people,
  });

  const run = async (configs: DeptConfig[], canonicalizer?: OrgUnitCanonicalizer) => {
    const emitted: ObservationInput[] = [];
    const loader = vi.fn(async () => {
      if (!canonicalizer) throw new Error('catalog not needed');
      return canonicalizer;
    });
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        if (Array.isArray(obs)) emitted.push(...obs);
        else emitted.push(obs);
      },
      log: () => {},
    };
    await new DepartmentRosterScraper(
      configs,
      null,
      vi.fn(async () => '<html><body></body></html>'),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      loader,
    ).run(ctx);
    return { emitted, loader };
  };
  const primaryDepartments = (emitted: ObservationInput[]) =>
    emitted
      .filter((o) => o.entityType === 'user' && o.field === 'primaryDepartment')
      .map((o) => String(o.value));
  const memberships = (emitted: ObservationInput[]) =>
    emitted
      .filter((o) => o.entityType === 'user' && o.field === 'departments')
      .map((o) => (o.value as string[])[0]);

  it('lets only the roster of the primary appointment assert it for a joint appointee', async () => {
    const jointAppointee = {
      name: 'Jordan Fixture',
      email: 'jordan.fixture@yale.edu',
      title: 'Professor of Fixture Urology and of Fixture Pathology',
    };
    const { emitted, loader } = await run([
      config('fixture-urology', 'Fixture Urology', [jointAppointee]),
      config('fixture-pathology', 'Fixture Pathology', [jointAppointee]),
    ]);

    expect(primaryDepartments(emitted)).toEqual(['Fixture Urology']);
    expect(memberships(emitted).sort()).toEqual(['Fixture Pathology', 'Fixture Urology']);
    expect(loader).not.toHaveBeenCalled();
  });

  it('keeps asserting on a silent page', async () => {
    const { emitted } = await run([
      config('fixture-pathology', 'Fixture Pathology', [
        { name: 'Casey Fixture', email: 'casey.fixture@yale.edu' },
      ]),
    ]);

    expect(primaryDepartments(emitted)).toEqual(['Fixture Pathology']);
  });

  it('states a catalogued section, withholds an outside unit and ignores a non-unit note', async () => {
    const canonicalizer: OrgUnitCanonicalizer = {
      canonicalizeSchool: () => ({ value: '', matched: false }),
      canonicalizeDepartments: (raw) => ({
        values: typeof raw === 'string' && raw.startsWith('Fixture') ? [raw] : [],
        affiliationLabels: [],
        unmatched: [],
        dropped: [],
      }),
      schoolForDepartment: () => null,
      parentDepartmentsFor: (name) =>
        name === 'Fixture Digestive Unit' ? ['Internal Medicine'] : [],
    };
    const { emitted, loader } = await run(
      [
        config('fixture-medicine', 'Internal Medicine', [
          {
            name: 'Morgan Fixture',
            email: 'morgan.fixture@yale.edu',
            title: 'Professor of Medicine (Fixture Digestive Unit)',
          },
          {
            name: 'Riley Fixture',
            email: 'riley.fixture@yale.edu',
            title: 'Professor of Medicine (Fixture Other Unit)',
          },
          {
            name: 'Avery Fixture',
            email: 'avery.fixture@yale.edu',
            title: 'Professor of Medicine (On Leave Fall 2026)',
          },
        ]),
      ],
      canonicalizer,
    );

    expect(primaryDepartments(emitted)).toEqual(['Fixture Digestive Unit', 'Internal Medicine']);
    expect(memberships(emitted)).toEqual([
      'Internal Medicine',
      'Internal Medicine',
      'Internal Medicine',
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps asserting a non-unit note read against a catalog with no department rows', async () => {
    const schoolsOnly = createOrgUnitCanonicalizer(
      buildOrgUnitResolverIndex([
        { slug: 'fixture-school', name: 'Fixture School of Medicine', kind: 'SCHOOL' },
      ]),
    );
    const { emitted, loader } = await run(
      [
        config('fixture-medicine', 'Internal Medicine', [
          {
            name: 'Avery Fixture',
            email: 'avery.fixture@yale.edu',
            title: 'Professor of Medicine (On Leave Fall 2026)',
          },
        ]),
      ],
      schoolsOnly,
    );

    expect(primaryDepartments(emitted)).toEqual(['Internal Medicine']);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
