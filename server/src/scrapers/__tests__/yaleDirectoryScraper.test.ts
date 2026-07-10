/**
 * Tests for yaleDirectoryScraper. Focuses on the pure parsing/classification
 * functions (no network, no DB). The scraper.run() path is exercised with the
 * yaliesService and snapshotCache modules mocked, so pagination + emit semantics
 * + limit handling can be verified without ever talking to MongoDB or Yalies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyUserType,
  isFacultyPerson,
  isFacultyTitle,
  personToObservations,
  YaleDirectoryScraper,
} from '../sources/yaleDirectoryScraper';
import type { ObservationInput, ScraperContext } from '../types';

// Mock the yaliesService so the scraper doesn't make real HTTP calls. We also
// mock the snapshot cache so tests don't need MongoDB. vi.mock factories are
// hoisted, so the spy is declared via vi.hoisted to keep it accessible from
// the factory.
const { listYaliesSpy } = vi.hoisted(() => ({ listYaliesSpy: vi.fn() }));
vi.mock('../../services/yaliesService', () => ({
  listYalies: listYaliesSpy,
}));
vi.mock('../snapshotCache', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));

const mockedListYalies = listYaliesSpy;

describe('isFacultyTitle', () => {
  it('matches common faculty titles', () => {
    expect(isFacultyTitle('Professor of Physics')).toBe(true);
    expect(isFacultyTitle('Assistant Professor')).toBe(true);
    expect(isFacultyTitle('Senior Lecturer')).toBe(true);
    expect(isFacultyTitle('Research Scientist')).toBe(true);
    expect(isFacultyTitle('Clinical Instructor')).toBe(true);
  });

  it('returns false for empty / nullish / non-faculty titles', () => {
    expect(isFacultyTitle('')).toBe(false);
    expect(isFacultyTitle(null)).toBe(false);
    expect(isFacultyTitle(undefined)).toBe(false);
    expect(isFacultyTitle('Sophomore')).toBe(false);
    expect(isFacultyTitle('Office Manager')).toBe(false);
  });
});

describe('classifyUserType', () => {
  it('returns "professor" when title contains "professor"', () => {
    expect(classifyUserType('Professor of Physics')).toBe('professor');
    expect(classifyUserType('Associate Professor of Surgery')).toBe('professor');
  });

  it('returns "faculty" for non-professor faculty titles', () => {
    expect(classifyUserType('Senior Lecturer')).toBe('faculty');
    expect(classifyUserType('Research Scientist')).toBe('faculty');
    expect(classifyUserType('')).toBe('faculty');
    expect(classifyUserType(null)).toBe('faculty');
  });
});

describe('isFacultyPerson', () => {
  it('treats Yale College (YC) records as non-faculty', () => {
    expect(
      isFacultyPerson({
        netid: 'abc123',
        school_code: 'YC',
        title: 'Professor',
      }),
    ).toBe(false);
  });

  it('treats records with a faculty title as faculty', () => {
    expect(
      isFacultyPerson({
        netid: 'abc123',
        title: 'Associate Professor of Cell Biology',
      }),
    ).toBe(true);
  });

  it('treats records with a title and no year as faculty', () => {
    expect(
      isFacultyPerson({
        netid: 'def456',
        title: 'Senior Research Associate',
      }),
    ).toBe(true);
  });

  it('treats records with a year as students (not faculty)', () => {
    expect(
      isFacultyPerson({
        netid: 'ghi789',
        title: 'Graduate Student',
        year: '2026',
      }),
    ).toBe(false);
  });

  it('returns false for nullish / netid-less inputs', () => {
    expect(isFacultyPerson(null as any)).toBe(false);
    expect(isFacultyPerson({} as any)).toBe(false);
  });
});

describe('personToObservations', () => {
  it('maps a realistic faculty record to a complete observation list', () => {
    const sample = {
      netid: 'jdoe24',
      first_name: 'Jane',
      last_name: 'Doe',
      preferred_name: 'Janie',
      email: 'jane.doe@yale.edu',
      phone: '+1 203 555 0001',
      title: 'Associate Professor of Molecular Biophysics & Biochemistry',
      school_code: 'GS',
      school: 'Graduate School of Arts and Sciences',
      school_name: 'Yale Graduate School of Arts and Sciences',
      college: '',
      organization_name: 'Yale School of Medicine',
      primary_organization_name: 'Yale School of Medicine',
      unit_name: 'Molecular Biophysics & Biochemistry',
      image: 'https://yalies.io/images/jdoe24.jpg',
      url: 'https://yalies.io/jdoe24',
      orcid: '0000-0001-2345-6789',
    };

    const obs = personToObservations(sample, 'https://api.yalies.io/v2/people');

    // Build a quick lookup by field for easy assertions.
    const byField: Record<string, ObservationInput> = {};
    for (const o of obs) byField[o.field] = o;

    expect(byField.netid?.value).toBe('jdoe24');
    expect(byField.fname?.value).toBe('Janie'); // preferred_name wins
    expect(byField.lname?.value).toBe('Doe');
    expect(byField.email?.value).toBe('jane.doe@yale.edu');
    expect(byField.userType?.value).toBe('professor');
    expect(byField.title?.value).toContain('Professor');
    expect(byField.primaryDepartment?.value).toBe('Molecular Biophysics & Biochemistry');
    expect(byField.secondaryDepartments?.value).toEqual(['Yale School of Medicine']);
    expect(byField.school?.value).toBe('Yale Graduate School of Arts and Sciences');
    expect(byField.imageUrl?.value).toBe('https://yalies.io/images/jdoe24.jpg');
    expect(byField.phone?.value).toBe('+1 203 555 0001');
    expect(byField.orcid?.value).toBe('0000-0001-2345-6789');
    expect(byField.profileUrls?.value).toEqual({ yalies: 'https://yalies.io/jdoe24' });

    // All observations should be keyed by netid + entityType=user.
    for (const o of obs) {
      expect(o.entityType).toBe('user');
      expect(o.entityKey).toBe('jdoe24');
      expect(o.sourceUrl).toBe('https://api.yalies.io/v2/people');
    }

    // College was empty so should not be present.
    expect(byField.college).toBeUndefined();
  });

  it('falls back to first_name when preferred_name is absent', () => {
    const obs = personToObservations({
      netid: 'xy01',
      first_name: 'Xavier',
      last_name: 'Yu',
      title: 'Lecturer in Astronomy',
    });
    const byField: Record<string, ObservationInput> = {};
    for (const o of obs) byField[o.field] = o;
    expect(byField.fname?.value).toBe('Xavier');
    expect(byField.userType?.value).toBe('faculty');
  });

  it('returns [] for records missing netid', () => {
    expect(
      personToObservations({
        first_name: 'No',
        last_name: 'NetID',
        title: 'Professor',
      }),
    ).toEqual([]);
  });

  it('returns [] for non-faculty records (students)', () => {
    expect(
      personToObservations({
        netid: 'stu123',
        first_name: 'Sally',
        last_name: 'Student',
        school_code: 'YC',
        year: '2027',
      }),
    ).toEqual([]);
  });

  it('omits empty / blank optional fields entirely', () => {
    const obs = personToObservations({
      netid: 'min01',
      first_name: 'Min',
      last_name: 'Imal',
      title: 'Senior Lecturer',
      // everything else absent
    });
    const fields = obs.map((o) => o.field);
    expect(fields).toContain('netid');
    expect(fields).toContain('fname');
    expect(fields).toContain('lname');
    expect(fields).toContain('userType');
    expect(fields).toContain('title');
    expect(fields).not.toContain('email');
    expect(fields).not.toContain('phone');
    expect(fields).not.toContain('orcid');
    expect(fields).not.toContain('imageUrl');
    expect(fields).not.toContain('profileUrls');
    expect(fields).not.toContain('secondaryDepartments');
  });
});

describe('YaleDirectoryScraper.run', () => {
  const ORIGINAL_KEY = process.env.YALIES_API_KEY;

  beforeEach(() => {
    mockedListYalies.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.YALIES_API_KEY;
    } else {
      process.env.YALIES_API_KEY = ORIGINAL_KEY;
    }
  });

  function buildContext(overrides: Partial<ScraperContext> = {}): {
    ctx: ScraperContext;
    emitted: ObservationInput[];
    logs: string[];
  } {
    const emitted: ObservationInput[] = [];
    const logs: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source-id',
      sourceName: 'yale-directory',
      sourceWeight: 0.9,
      options: { dryRun: false, useCache: false, release: false, ...((overrides.options as any) || {}) },
      emit: async (input) => {
        const arr = Array.isArray(input) ? input : [input];
        for (const o of arr) emitted.push(o);
      },
      log: (msg) => {
        logs.push(msg);
      },
      ...overrides,
    };
    return { ctx, emitted, logs };
  }

  it('exits gracefully (no throw) when YALIES_API_KEY is missing', async () => {
    delete process.env.YALIES_API_KEY;
    const { ctx, emitted, logs } = buildContext();
    const scraper = new YaleDirectoryScraper();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toMatch(/YALIES_API_KEY/);
    expect(emitted).toEqual([]);
    expect(logs.some((l) => l.includes('YALIES_API_KEY'))).toBe(true);
    expect(mockedListYalies).not.toHaveBeenCalled();
  });

  it('paginates until a short page is returned', async () => {
    process.env.YALIES_API_KEY = 'test-key';

    // Build a faculty record we know personToObservations will accept.
    const facultyRecord = {
      netid: 'aa01',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@yale.edu',
      title: 'Professor of Computer Science',
      unit_name: 'Computer Science',
    };
    // Page 1: 200 identical-shape records (using distinct netids), Page 2: 1 record.
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      ...facultyRecord,
      netid: `aa${String(i).padStart(3, '0')}`,
    }));
    const page2 = [{ ...facultyRecord, netid: 'aaLast' }];

    mockedListYalies
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { ctx, emitted } = buildContext();
    const scraper = new YaleDirectoryScraper();
    const result = await scraper.run(ctx);

    expect(mockedListYalies).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(201);
    // Distinct entity keys should match the 201 distinct netids.
    const keys = new Set(emitted.map((o) => o.entityKey));
    expect(keys.size).toBe(201);
    expect(keys.has('aaLast')).toBe(true);
  });

  it('respects ctx.options.limit', async () => {
    process.env.YALIES_API_KEY = 'test-key';
    const facultyRecord = {
      netid: 'bb01',
      first_name: 'Grace',
      last_name: 'Hopper',
      email: 'grace@yale.edu',
      title: 'Professor of Naval Engineering',
      unit_name: 'Engineering',
    };
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      ...facultyRecord,
      netid: `bb${String(i).padStart(3, '0')}`,
    }));
    mockedListYalies.mockResolvedValueOnce(page1);

    const { ctx, emitted } = buildContext({
      options: { dryRun: false, useCache: false, release: false, limit: 5 },
    });
    const scraper = new YaleDirectoryScraper();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(5);
    const keys = new Set(emitted.map((o) => o.entityKey));
    expect(keys.size).toBe(5);
    // Should have stopped after first page (no second call).
    expect(mockedListYalies).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe runtime limits before fetching directory pages', async () => {
    process.env.YALIES_API_KEY = 'test-key';
    const { ctx } = buildContext({
      options: { dryRun: false, useCache: false, release: false, limit: 9007199254740992 },
    });
    const scraper = new YaleDirectoryScraper();

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(mockedListYalies).not.toHaveBeenCalled();
  });

  it('skips non-faculty records returned by the API', async () => {
    process.env.YALIES_API_KEY = 'test-key';
    mockedListYalies.mockResolvedValueOnce([
      {
        netid: 'fac01',
        first_name: 'Faye',
        last_name: 'Faculty',
        title: 'Professor',
        unit_name: 'Linguistics',
      },
      {
        netid: 'stu01',
        first_name: 'Stu',
        last_name: 'Student',
        school_code: 'YC',
        year: '2026',
      },
    ]);

    const { ctx, emitted } = buildContext();
    const scraper = new YaleDirectoryScraper();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    const keys = new Set(emitted.map((o) => o.entityKey));
    expect(keys.has('fac01')).toBe(true);
    expect(keys.has('stu01')).toBe(false);
  });

  it('aborts gracefully on network error mid-pagination', async () => {
    process.env.YALIES_API_KEY = 'test-key';
    // First page must be a full PAGE_SIZE so the scraper requests a second page.
    const fillerPage = Array.from({ length: 200 }, (_, i) => ({
      netid: `cc${String(i).padStart(3, '0')}`,
      first_name: 'Net',
      last_name: 'Worker',
      title: 'Professor of Networks',
    }));
    mockedListYalies
      .mockResolvedValueOnce(fillerPage)
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const { ctx, emitted, logs } = buildContext();
    const scraper = new YaleDirectoryScraper();
    const result = await scraper.run(ctx);

    // Page 1 succeeded, page 2 errored — scraper should have logged and returned.
    expect(result.entitiesObserved).toBe(200);
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /ECONNRESET|aborting/i.test(l))).toBe(true);
  });
});
