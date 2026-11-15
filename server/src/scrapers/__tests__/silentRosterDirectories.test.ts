import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DEFAULT_DEPT_CONFIGS,
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
  rosterDepartmentVocabulary,
} from '../sources/departmentRosterScraper';
import { rosterHomeDepartmentStatement } from '../rosterHomeDepartmentStatement';
import { configForReading } from '../../scripts/auditSilentRosterDirectories';
import { ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT } from '../rosterHomeDepartmentScreen';
import {
  SILENT_DIRECTORY_AUDIT_COMMAND,
  classifySilentDirectory,
  firstHandDisagrees,
  silentDirectoryWarnings,
  type RosterDisagreementTally,
} from '../silentRosterDirectories';
import type { ObservationInput, ScraperContext } from '../types';

const tally = (overrides: Partial<RosterDisagreementTally>): RosterDisagreementTally => ({
  deptKey: 'fixture-programme',
  assertsHomeDepartment: true,
  entries: 20,
  untitled: 18,
  withFirstHand: 12,
  disagree: 11,
  ...overrides,
});

describe('the silent roster directory predicate (#6299)', () => {
  it('warns on a silent, disagreeing config that still asserts a home department', () => {
    expect(classifySilentDirectory(tally({}))).toBe('silent-high-disagreement');
    expect(silentDirectoryWarnings([tally({})])).toEqual(['fixture-programme']);
  });

  it('does not warn on a config that already withholds the home department', () => {
    expect(silentDirectoryWarnings([tally({ assertsHomeDepartment: false })])).toEqual([]);
  });

  it('does not warn on a titled config, however much it disagrees', () => {
    expect(classifySilentDirectory(tally({ untitled: 4 }))).toBe('titled');
    expect(silentDirectoryWarnings([tally({ untitled: 4 })])).toEqual([]);
  });

  it('does not judge a silent config with too few first-hand readings', () => {
    expect(classifySilentDirectory(tally({ withFirstHand: 9, disagree: 9 }))).toBe(
      'silent-insufficient-evidence',
    );
    expect(silentDirectoryWarnings([tally({ withFirstHand: 9, disagree: 9 })])).toEqual([]);
  });

  it('does not warn on a silent config whose people mostly agree', () => {
    expect(classifySilentDirectory(tally({ disagree: 5 }))).toBe('silent-low-disagreement');
  });

  it('reads a catalog section under the roster department as agreement', () => {
    const catalog = {
      canonicalDepartment: (name: string) =>
        ['Fixture Medicine', 'Fixture Digestive Unit', 'Fixture Pathology'].includes(name)
          ? name
          : undefined,
      parentDepartmentsFor: (name: string) =>
        name === 'Fixture Digestive Unit' ? ['Fixture Medicine'] : [],
    };
    const disagrees = (units: string[]) =>
      firstHandDisagrees({
        rosterDepartment: 'Fixture Medicine',
        firstHandUnits: units,
        ...catalog,
      });
    expect(disagrees(['Fixture Medicine'])).toBe(false);
    expect(disagrees(['Fixture Digestive Unit'])).toBe(false);
    expect(disagrees(['Fixture Pathology'])).toBe(true);
    expect(disagrees(['A Fixture Research Program'])).toBe(true);
  });
});

describe('the three title-less programme rosters withhold the home department (#6299)', () => {
  const PROGRAMME_ROSTERS = [
    'applied-mathematics',
    'film-media-studies',
    'history-science-medicine-public-health',
  ];

  it.each(PROGRAMME_ROSTERS)('sets withholdsHomeDepartment on %s', (deptKey) => {
    const configs = DEFAULT_DEPT_CONFIGS.filter((config) => config.deptKey === deptKey);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs.every((config) => config.withholdsHomeDepartment === true)).toBe(true);
    for (const config of configs) {
      expect(ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT.has(config.deptName)).toBe(true);
    }
  });

  it.each(PROGRAMME_ROSTERS)(
    'keeps %s a department another roster title can name first',
    (deptKey) => {
      const programme = DEFAULT_DEPT_CONFIGS.find((config) => config.deptKey === deptKey)!;
      const statement = rosterHomeDepartmentStatement({
        deptName: 'Fixture Letters',
        title: `Professor of ${programme.deptName} and of Fixture Letters`,
        departmentNames: rosterDepartmentVocabulary([]),
      });
      expect(statement).toEqual({ kind: 'withhold', reason: 'another-department-first' });
    },
  );

  it('keeps a withheld centre name out of the title vocabulary', () => {
    const centres = DEFAULT_DEPT_CONFIGS.filter(
      (config) => config.withholdsHomeDepartment && !config.namesCatalogDepartment,
    );
    expect(centres.length).toBeGreaterThan(0);
    const vocabulary = rosterDepartmentVocabulary([]);
    for (const centre of centres) expect(vocabulary.has(centre.deptName)).toBe(false);
  });
});

describe('the audit attributes each roster reading to its config (#6299)', () => {
  const fixtureConfig = (overrides: Partial<DeptConfig>): DeptConfig => ({
    deptKey: 'fixture-page',
    deptName: 'Fixture Page',
    schoolName: 'Fixture School',
    url: 'https://fixture.example.edu/people',
    extractor: () => [],
    ...overrides,
  });

  it('maps a reading stored under the config data endpoint', () => {
    const config = fixtureConfig({ dataUrl: 'https://data.fixture.example.edu/load/7' });
    expect(configForReading('https://data.fixture.example.edu/load/7', [config])).toBe(config);
    expect(configForReading('https://other.example.edu/people', [config])).toBeUndefined();
  });

  it('prefers the config whose page path matches most closely', () => {
    const broad = fixtureConfig({ deptKey: 'fixture-broad' });
    const narrow = fixtureConfig({
      deptKey: 'fixture-narrow',
      url: 'https://fixture.example.edu/people/faculty',
    });
    expect(configForReading('https://fixture.example.edu/people/faculty/', [broad, narrow])).toBe(
      narrow,
    );
    expect(configForReading('https://fixture.example.edu/people/staff', [broad, narrow])).toBe(
      broad,
    );
  });
});

describe('a roster run names the silent pages it read (#6299)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T00:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const people = (titled: boolean): FacultyEntry[] =>
    Array.from({ length: 5 }, (_unused, index) => ({
      name: `Fixture Person${String.fromCharCode(65 + index)}`,
      email: `fixture.person${index}@yale.edu`,
      ...(titled ? { title: 'Professor of Fixture Programme' } : {}),
    }));
  const config = (titled: boolean, withholdsHomeDepartment: boolean): DeptConfig => ({
    deptKey: 'fixture-programme',
    deptName: 'Fixture Programme',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://fixture-programme.example.edu/people/',
    paginated: false,
    extractor: () => people(titled),
    ...(withholdsHomeDepartment ? { withholdsHomeDepartment: true } : {}),
  });
  const runLog = async (titled: boolean, withholdsHomeDepartment: boolean) => {
    const lines: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (_obs: ObservationInput | ObservationInput[]) => {},
      log: (line: string) => lines.push(line),
    };
    await new DepartmentRosterScraper(
      [config(titled, withholdsHomeDepartment)],
      null,
      vi.fn(async () => '<html><body></body></html>'),
    ).run(ctx);
    return lines.filter((line) => line.includes(SILENT_DIRECTORY_AUDIT_COMMAND));
  };

  it('points a silent page that asserts a home department at the warn-only audit', async () => {
    const notes = await runLog(false, false);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('warn-only');
    expect(notes[0]).toContain('fixture-programme');
  });

  it('says nothing for a silent page that already withholds the home department', async () => {
    expect(await runLog(false, true)).toEqual([]);
  });

  it('says nothing for a titled page', async () => {
    expect(await runLog(true, false)).toEqual([]);
  });
});
