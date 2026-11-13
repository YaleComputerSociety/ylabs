import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import { CONFIGS_EXPECTED_ABSENT_FROM_CATALOG } from '../../scripts/auditDepartmentCatalogDriftCore';
import {
  DEFAULT_DEPT_CONFIGS,
  DepartmentRosterScraper,
  rosterMintWithdrawnEntityKey,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import { rosterBioDepartmentResolver } from '../sources/rosterBioResearchEvidenceScraper';
import {
  ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT,
  withoutWithheldRosterHomeDepartments,
} from '../rosterHomeDepartmentScreen';
import type { ObservationInput, ScraperContext } from '../types';
import { withUserDepartmentObservationsScreened } from '../userDepartmentObservationScreens';

const withholdsHome = (config: DeptConfig): boolean =>
  Boolean(
    config.withholdsHomeDepartment ||
      config.affiliatesOnly ||
      config.schoolWideDirectory ||
      config.crossListedProgramme,
  );

const CATALOG_DEPARTMENT_CONFIGS: Readonly<Record<string, string>> = {
  'wright-lab': 'Its deptName is Physics, the catalog department its people belong to.',
  'ysm-biomedical-informatics-data-science':
    'Its deptName is Biomedical Informatics & Data Science, a catalog department.',
};

describe('withholdsHomeDepartment on center and program rosters (#6071)', () => {
  it('is set on the three center and program rosters', () => {
    for (const deptKey of ['stem-cell-center', 'west-campus', 'physician-associate-program']) {
      const configs = DEFAULT_DEPT_CONFIGS.filter((config) => config.deptKey === deptKey);
      expect(configs.length).toBeGreaterThan(0);
      expect(configs.every((config) => config.withholdsHomeDepartment === true)).toBe(true);
    }
  });

  it('holds every config the catalog drift audit expects to be absent to a withheld home department', () => {
    const offenders = DEFAULT_DEPT_CONFIGS.filter(
      (config) =>
        config.deptKey in CONFIGS_EXPECTED_ABSENT_FROM_CATALOG &&
        !(config.deptKey in CATALOG_DEPARTMENT_CONFIGS) &&
        !withholdsHome(config),
    ).map((config) => config.deptKey);
    expect(offenders).toEqual([]);
    for (const deptKey of Object.keys(CATALOG_DEPARTMENT_CONFIGS)) {
      expect(deptKey in CONFIGS_EXPECTED_ABSENT_FROM_CATALOG).toBe(true);
    }
  });

  it('screens exactly the names whose every config withholds the home department', () => {
    const byName = new Map<string, DeptConfig[]>();
    for (const config of DEFAULT_DEPT_CONFIGS) {
      byName.set(config.deptName, [...(byName.get(config.deptName) ?? []), config]);
    }
    const withheld = [...byName]
      .filter(([, configs]) => configs.every((config) => config.withholdsHomeDepartment === true))
      .map(([name]) => name)
      .sort();
    expect([...ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT].sort()).toEqual(withheld);
  });

  it('screens a stored roster reading of a withheld name and nothing else', () => {
    const readings = [
      { field: 'primaryDepartment', value: 'Stem Cell Center', sourceName: 'dept-faculty-roster' },
      { field: 'primaryDepartment', value: 'Surgery', sourceName: 'dept-faculty-roster' },
      { field: 'departments', value: ['Stem Cell Center'], sourceName: 'dept-faculty-roster' },
      { field: 'primaryDepartment', value: 'Stem Cell Center', sourceName: 'fixture-lane' },
    ];
    expect(withoutWithheldRosterHomeDepartments(readings)).toEqual(readings.slice(1));
  });

  it('is one of the resolver department screens', () => {
    const reading = {
      field: 'primaryDepartment',
      value: 'West Campus Institutes',
      sourceName: 'dept-faculty-roster',
    };
    expect(withUserDepartmentObservationsScreened([reading], { canonicalDepartment: null })).toEqual(
      [],
    );
  });
});

describe('a roster that withholds the home department changes nothing else', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const people = (): FacultyEntry[] => [
    {
      name: 'Robin Roster',
      profileUrl: 'https://fixture-center.example.edu/profile/robin-roster/',
      title: 'Professor of Fixture Studies',
      email: 'robin.roster@yale.edu',
    },
    {
      name: 'Sam Sample',
      profileUrl: 'https://fixture-center.example.edu/profile/sam-sample/',
      title: 'Research Scientist',
    },
  ];
  const config = (withholdsHomeDepartment: boolean): DeptConfig => ({
    deptKey: 'fixture-center',
    deptName: 'Fixture Center',
    schoolName: 'Yale School of Medicine',
    url: 'https://fixture-center.example.edu/people/',
    paginated: false,
    extractor: () => people(),
    ...(withholdsHomeDepartment ? { withholdsHomeDepartment: true } : {}),
  });
  const run = async (withholdsHomeDepartment: boolean) => {
    const emitted: ObservationInput[] = [];
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
      [config(withholdsHomeDepartment)],
      null,
      vi.fn(async () => '<html><body></body></html>'),
    ).run(ctx);
    return emitted;
  };
  const isPersonHomeDepartment = (o: ObservationInput) =>
    o.entityType === 'user' && o.field === 'primaryDepartment';

  it('withholds only the person primaryDepartment', async () => {
    const flagged = await run(true);
    const unflagged = await run(false);

    expect(unflagged.filter(isPersonHomeDepartment).length).toBe(2);
    expect(flagged.filter(isPersonHomeDepartment)).toEqual([]);
    expect(flagged).toEqual(unflagged.filter((o) => !isPersonHomeDepartment(o)));
  });

  it('keeps the members, the departments label and the roster-health snapshot', async () => {
    const flagged = await run(true);
    const memberKeys = new Set(
      flagged.filter((o) => o.entityType === 'user').map((o) => o.entityKey),
    );
    expect(memberKeys.size).toBe(2);
    expect(
      flagged.filter((o) => o.entityType === 'user' && o.field === 'departments').length,
    ).toBe(2);
    expect(flagged.some((o) => o.entityType === 'departmentRosterHealth')).toBe(true);
  });

  it('leaves withdrawn-key handling and roster-bio minting as they were', () => {
    const entry = { ...people()[0], profileReadOutcome: 'read' } as FacultyEntry;
    const mint = { observations: [], refusedByTitle: false };
    expect(rosterMintWithdrawnEntityKey(entry, config(true), mint)).toBe(
      rosterMintWithdrawnEntityKey(entry, config(false), mint),
    );
    expect(rosterMintWithdrawnEntityKey(entry, config(true), mint)).not.toBe('');

    const person = {
      key: 'netid:rr1',
      bio: 'Fixture bio.',
      departments: ['Fixture Center'],
      rosterSourceUrl: 'https://fixture-center.example.edu/people/',
    };
    expect(rosterBioDepartmentResolver([config(true)])(person, 'Robin Roster')).toEqual(
      rosterBioDepartmentResolver([config(false)])(person, 'Robin Roster'),
    );
    expect(rosterBioDepartmentResolver([config(true)])(person, 'Robin Roster')).not.toBeNull();
  });
});
