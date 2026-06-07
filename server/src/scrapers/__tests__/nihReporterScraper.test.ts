/**
 * Unit tests for NihReporterScraper.
 *
 * The pure helpers (`canonicalPiName`, `groupGrantsByPi`, `grantToRecord`,
 * `piGrantsToObservations`) are tested directly. `findUserForPi` is exercised
 * with a hand-built mock User model. The full `run()` is tested by stubbing
 * `axios.post` for the network and passing a mock User model so no DB or
 * real HTTP I/O occurs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import {
  NihReporterScraper,
  canonicalPiName,
  pickContactPiName,
  piEntityKey,
  piSlugForResearchGroup,
  groupGrantsByPi,
  grantToRecord,
  piGrantsToObservations,
  findUserForPi,
  type NihGrant,
} from '../sources/nihReporterScraper';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Sample fixtures (shape matches a real NIH RePORTER `results[i]` record)
// ---------------------------------------------------------------------------

const grantArnsten: NihGrant = {
  project_num: '5R01MH123456-03',
  appl_id: 11000001,
  core_project_num: 'R01MH123456',
  project_title: 'Prefrontal cortex circuits in cognitive aging',
  abstract_text: 'We will study PFC circuit dynamics in aging primates.',
  contact_pi_name: 'ARNSTEN, AMY F',
  principal_investigators: [
    {
      profile_id: 1,
      first_name: 'Amy',
      last_name: 'Arnsten',
      full_name: 'Amy F Arnsten',
      is_contact_pi: true,
    },
  ],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'NEUROSCIENCES' },
  fiscal_year: 2025,
  award_amount: 654321,
  project_start_date: '2025-04-01T00:00:00',
  project_end_date: '2030-03-31T00:00:00',
  agency_ic_admin: { code: 'MH', abbreviation: 'NIMH', name: 'NIMH' },
  activity_code: 'R01',
  project_detail_url: 'https://reporter.nih.gov/project-details/11000001',
};

const grantArnsten2: NihGrant = {
  ...grantArnsten,
  project_num: '5R21AG999999-01',
  appl_id: 11000002,
  core_project_num: 'R21AG999999',
  project_title: 'Adrenergic modulation in working memory',
  fiscal_year: 2024,
  award_amount: 230000,
  project_start_date: '2024-08-15T00:00:00',
  project_end_date: '2026-07-31T00:00:00',
  agency_ic_admin: { code: 'AG', abbreviation: 'NIA', name: 'NIA' },
  project_detail_url: 'https://reporter.nih.gov/project-details/11000002',
};

const grantBreaker: NihGrant = {
  project_num: '1R35GM222222-01',
  appl_id: 12000001,
  project_title: 'Riboswitch discovery and bacterial gene control',
  abstract_text: '',
  contact_pi_name: 'BREAKER, RONALD R',
  principal_investigators: [
    {
      profile_id: 2,
      first_name: 'Ronald',
      last_name: 'Breaker',
      is_contact_pi: true,
    },
  ],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'BIOLOGY' },
  fiscal_year: 2025,
  award_amount: 1000000,
  project_start_date: '2025-01-01T00:00:00',
  project_end_date: '2030-12-31T00:00:00',
  agency_ic_admin: { code: 'GM', abbreviation: 'NIGMS', name: 'NIGMS' },
  activity_code: 'R35',
  project_detail_url: 'https://reporter.nih.gov/project-details/12000001',
};

const grantOrphan: NihGrant = {
  project_num: '5F31AI181508-01',
  appl_id: 13000001,
  project_title: 'Trainee fellowship — no contact PI structured',
  contact_pi_name: '',
  principal_investigators: [],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'IMMUNOLOGY' },
  fiscal_year: 2025,
};

// ---------------------------------------------------------------------------
// canonicalPiName + piEntityKey + piSlugForResearchGroup
// ---------------------------------------------------------------------------

describe('canonicalPiName', () => {
  it('converts "LAST, FIRST MIDDLE" into "First Last"', () => {
    expect(canonicalPiName('ARNSTEN, AMY F')).toBe('Amy Arnsten');
    expect(canonicalPiName('BREAKER, RONALD R')).toBe('Ronald Breaker');
  });

  it('passes through already-natural-order names with title casing for ALL CAPS', () => {
    expect(canonicalPiName('AMY ARNSTEN')).toBe('Amy Arnsten');
  });

  it('returns empty string on falsy input', () => {
    expect(canonicalPiName('')).toBe('');
    expect(canonicalPiName(null)).toBe('');
    expect(canonicalPiName(undefined)).toBe('');
  });
});

describe('piEntityKey / piSlugForResearchGroup', () => {
  it('produces a deterministic, slug-friendly key per PI', () => {
    expect(piEntityKey('Amy Arnsten')).toBe('nih-pi:amy-arnsten');
    expect(piSlugForResearchGroup('Amy Arnsten')).toBe('nih-pi-amy-arnsten');
  });
  it('returns empty string for empty input', () => {
    expect(piEntityKey('')).toBe('');
    expect(piSlugForResearchGroup('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// pickContactPiName
// ---------------------------------------------------------------------------

describe('pickContactPiName', () => {
  it('prefers the structured is_contact_pi entry over the unstructured string', () => {
    expect(pickContactPiName(grantArnsten)).toBe('Amy Arnsten');
  });

  it('falls back to contact_pi_name when no structured PI is marked contact', () => {
    const grant: NihGrant = {
      ...grantArnsten,
      principal_investigators: [],
      contact_pi_name: 'SMITH, JOHN',
    };
    expect(pickContactPiName(grant)).toBe('John Smith');
  });

  it('returns empty string when nothing identifies a PI', () => {
    expect(pickContactPiName(grantOrphan)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// groupGrantsByPi
// ---------------------------------------------------------------------------

describe('groupGrantsByPi', () => {
  it('groups multiple grants for the same PI under a single canonical key', () => {
    const groups = groupGrantsByPi([grantArnsten, grantArnsten2, grantBreaker]);
    expect(groups.size).toBe(2);
    expect(groups.get('Amy Arnsten')).toHaveLength(2);
    expect(groups.get('Ronald Breaker')).toHaveLength(1);
  });

  it('drops grants with no resolvable contact PI', () => {
    const groups = groupGrantsByPi([grantArnsten, grantOrphan]);
    expect(groups.size).toBe(1);
    expect(groups.has('Amy Arnsten')).toBe(true);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupGrantsByPi([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// grantToRecord
// ---------------------------------------------------------------------------

describe('grantToRecord', () => {
  it('normalizes the API record to the schema-shaped record', () => {
    const rec = grantToRecord(grantArnsten);
    expect(rec.id).toBe('5R01MH123456-03');
    expect(rec.agency).toBe('NIMH');
    expect(rec.title).toBe('Prefrontal cortex circuits in cognitive aging');
    expect(rec.abstract).toBe('We will study PFC circuit dynamics in aging primates.');
    expect(rec.startDate).toBeInstanceOf(Date);
    expect(rec.startDate?.toISOString().slice(0, 10)).toBe('2025-04-01');
    expect(rec.endDate?.toISOString().slice(0, 10)).toBe('2030-03-31');
    expect(rec.dollarAmount).toBe(654321);
    expect(rec.url).toBe('https://reporter.nih.gov/project-details/11000001');
    expect(rec.role).toBe('pi');
  });

  it('falls back to a stable id and url when project_num/url are missing', () => {
    const grant: NihGrant = {
      appl_id: 99,
      project_title: 'Untitled',
      principal_investigators: [],
      contact_pi_name: 'X, Y',
    };
    const rec = grantToRecord(grant);
    expect(rec.id).toBe('appl-99');
    expect(rec.url).toContain('reporter.nih.gov/project-details/99');
    expect(rec.dollarAmount).toBe(0);
  });

  it('defaults agency to NIH when agency_ic_admin is absent', () => {
    const grant: NihGrant = {
      project_num: 'X',
      project_title: 'Y',
      principal_investigators: [],
      contact_pi_name: 'A, B',
    };
    expect(grantToRecord(grant).agency).toBe('NIH');
  });
});

// ---------------------------------------------------------------------------
// findUserForPi (mocked User model)
// ---------------------------------------------------------------------------

function mockUserModel(rows: any[]) {
  return {
    find: vi.fn(() => ({
      limit: () => ({
        lean: async () => rows,
      }),
    })) as any,
  };
}

describe('findUserForPi', () => {
  it('returns null when no candidates match the surname', async () => {
    const um = mockUserModel([]);
    expect(await findUserForPi('Amy Arnsten', um)).toBeNull();
  });

  it('returns the unique candidate when there is exactly one exact first-name surname match', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amy', lname: 'Arnsten', netid: 'aa1' },
    ]);
    expect(await findUserForPi('Amy Arnsten', um)).toEqual({
      _id: 'u1',
      netid: 'aa1',
      researchHomeEligible: true,
    });
  });

  it('does not match a unique surname candidate when the full first name conflicts', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Frederick', lname: 'Wilson', netid: 'fpw2' },
    ]);
    expect(await findUserForPi('Francis Wilson', um)).toBeNull();
  });

  it('disambiguates by exact first name when surname has multiple hits', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amy', lname: 'Arnsten', netid: 'aa1' },
      { _id: 'u2', fname: 'John', lname: 'Arnsten', netid: 'ja1' },
    ]);
    expect(await findUserForPi('Amy Arnsten', um)).toEqual({
      _id: 'u1',
      netid: 'aa1',
      researchHomeEligible: true,
    });
  });

  it('falls back to given-name prefix match when exact fname fails', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amylynn', lname: 'Arnsten', netid: 'ax1' },
      { _id: 'u2', fname: 'John', lname: 'Arnsten', netid: 'ja1' },
    ]);
    expect(await findUserForPi('Amy Arnsten', um)).toEqual({
      _id: 'u1',
      netid: 'ax1',
      researchHomeEligible: true,
    });
  });

  it('falls back to first-initial match only when the source first name is an initial', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amelia', lname: 'Arnsten', netid: 'ax1' },
      { _id: 'u2', fname: 'John', lname: 'Arnsten', netid: 'ja1' },
    ]);
    expect(await findUserForPi('A Arnsten', um)).toEqual({
      _id: 'u1',
      netid: 'ax1',
      researchHomeEligible: true,
    });
  });

  it('does not match full first names to different same-initial candidates', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amelia', lname: 'Arnsten', netid: 'ax1' },
      { _id: 'u2', fname: 'John', lname: 'Arnsten', netid: 'ja1' },
    ]);
    expect(await findUserForPi('Amy Arnsten', um)).toBeNull();
  });

  it('marks postdoctoral and research-affiliate grant PIs as ineligible research homes', async () => {
    const postdoc = mockUserModel([
      {
        _id: 'u1',
        fname: 'James',
        lname: 'Hutchison',
        netid: 'jh1',
        title: 'Postdoctoral Associate in Pharmacology',
      },
    ]);
    expect(await findUserForPi('James Hutchison', postdoc)).toEqual({
      _id: 'u1',
      netid: 'jh1',
      researchHomeEligible: false,
    });

    const affiliate = mockUserModel([
      {
        _id: 'u2',
        fname: 'Seyedmehdi',
        lname: 'Payabvash',
        netid: 'sp1',
        title: 'Research Affiliates',
      },
    ]);
    expect(await findUserForPi('Seyedmehdi Payabvash', affiliate)).toEqual({
      _id: 'u2',
      netid: 'sp1',
      researchHomeEligible: false,
    });
  });

  it('returns null when ambiguity remains after first-initial fallback', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amelia', lname: 'Arnsten', netid: 'ax1' },
      { _id: 'u2', fname: 'Anne', lname: 'Arnsten', netid: 'an1' },
    ]);
    expect(await findUserForPi('Amy Arnsten', um)).toBeNull();
  });

  it('returns null for an empty PI name', async () => {
    const um = mockUserModel([]);
    expect(await findUserForPi('', um)).toBeNull();
    // Should NOT have called find at all.
    expect(um.find).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// piGrantsToObservations
// ---------------------------------------------------------------------------

describe('piGrantsToObservations', () => {
  it('emits user + research-group observations when no Yale user is matched', () => {
    const obs = piGrantsToObservations('Amy Arnsten', [grantArnsten, grantArnsten2], null);

    const userObs = obs.filter((o) => o.entityType === 'user');
    expect(userObs.length).toBeGreaterThan(0);
    expect(userObs.every((o) => o.entityKey === 'nih-pi:amy-arnsten')).toBe(true);
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Amy');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Arnsten');
    expect(userObs.find((o) => o.field === 'userType')?.value).toBe('faculty');

    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    expect(groupObs.every((o) => o.entityKey === 'nih-pi-amy-arnsten')).toBe(true);
    expect(groupObs.find((o) => o.field === 'slug')?.value).toBe('nih-pi-amy-arnsten');
    expect(groupObs.find((o) => o.field === 'name')?.value).toBe('Amy Arnsten Lab');
    expect(groupObs.find((o) => o.field === 'kind')?.value).toBe('lab');
    expect(groupObs.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NIH']);

    const recentGrants = groupObs.find((o) => o.field === 'recentGrants')?.value as any[];
    expect(recentGrants).toHaveLength(2);
    // Sorted descending by start_date — Arnsten1 (2025-04-01) before Arnsten2 (2024-08-15).
    expect(recentGrants[0].id).toBe('5R01MH123456-03');
    expect(recentGrants[1].id).toBe('5R21AG999999-01');

    expect(groupObs.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
    const lastObserved = groupObs.find((o) => o.field === 'lastObservedAt')?.value as Date;
    expect(lastObserved).toBeInstanceOf(Date);
    expect(lastObserved.toISOString().slice(0, 10)).toBe('2025-04-01');

    expect(groupObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe(
      'nih-pi:amy-arnsten',
    );
    expect(groupObs.find((o) => o.field === 'inferredPiUserId')).toBeUndefined();
  });

  it('skips the user observation block and emits inferredPiUserId when matched', () => {
    const obs = piGrantsToObservations('Ronald Breaker', [grantBreaker], {
      _id: 'user-abc',
      netid: 'rrb1',
    });
    expect(obs.filter((o) => o.entityType === 'user')).toHaveLength(0);
    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    const piId = groupObs.find((o) => o.field === 'inferredPiUserId');
    expect(piId?.value).toBe('user-abc');
    expect(piId?.confidenceOverride).toBeGreaterThanOrEqual(0.8);
    expect(groupObs.find((o) => o.field === 'inferredPiUserKey')).toBeUndefined();
  });

  it('emits no research-home observations for known non-owner grant PIs', () => {
    expect(
      piGrantsToObservations('James Hutchison', [grantArnsten], {
        _id: 'user-postdoc',
        netid: 'jh1',
        researchHomeEligible: false,
      }),
    ).toEqual([]);
  });

  it('truncates recentGrants to the configured cap', () => {
    const many: NihGrant[] = Array.from({ length: 20 }, (_v, i) => ({
      ...grantArnsten,
      project_num: `R01-${i}`,
      appl_id: 20000000 + i,
      project_start_date: `2024-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00`,
    }));
    const obs = piGrantsToObservations('Amy Arnsten', many, null);
    const recentGrants = obs.find(
      (o) => o.entityType === 'researchEntity' && o.field === 'recentGrants',
    )?.value as any[];
    expect(recentGrants).toHaveLength(10);
    expect(
      obs.find(
        (o) => o.entityType === 'researchEntity' && o.field === 'recentGrantCount',
      )?.value,
    ).toBe(10);
  });

  it('returns no observations on empty inputs', () => {
    expect(piGrantsToObservations('', [grantArnsten], null)).toEqual([]);
    expect(piGrantsToObservations('Amy Arnsten', [], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full run() with mocked axios + mocked User model
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'nih-reporter',
    sourceWeight: 0.9,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NihReporterScraper.run', () => {
  it('paginates the API, groups by PI, resolves users, and emits observations', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async (_url, body) => {
      const offset = (body as any).offset || 0;
      // Page 1 returns 2 grants for Arnsten + 1 for Breaker; page 2 returns empty.
      if (offset === 0) {
        return {
          data: { meta: { total: 3, offset: 0, limit: 500 }, results: [grantArnsten, grantArnsten2, grantBreaker] },
        } as any;
      }
      return { data: { meta: { total: 3, offset, limit: 500 }, results: [] } } as any;
    });

    // Match Breaker but not Arnsten.
    const userModel = {
      find: vi.fn((query: any) => ({
        limit: () => ({
          lean: async () => {
            // The query includes a regex on lname; we just check the source string.
            const src: string = query.lname?.source || '';
            if (/Breaker/i.test(src)) {
              return [{ _id: 'breaker-id', fname: 'Ronald', lname: 'Breaker', netid: 'rrb1' }];
            }
            return [];
          },
        }),
      })) as any,
    };

    const scraper = new NihReporterScraper({ userModel });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(postSpy).toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(2); // 2 unique PIs
    expect(result.notes).toContain('matched 1');
    expect(result.notes).toContain('stubbed 1');

    // Arnsten unmatched → user obs present
    const arnstenUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:amy-arnsten',
    );
    expect(arnstenUserObs.length).toBeGreaterThan(0);

    // Breaker matched → no user obs
    const breakerUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:ronald-breaker',
    );
    expect(breakerUserObs).toHaveLength(0);

    // Both should have ResearchGroup observations
    const arnstenGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-amy-arnsten',
    );
    expect(arnstenGroup.length).toBeGreaterThan(0);
    expect(arnstenGroup.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);

    const breakerGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-ronald-breaker',
    );
    expect(breakerGroup.find((o) => o.field === 'inferredPiUserId')?.value).toBe('breaker-id');
  });

  it('honors the limit option (caps PIs processed, not raw grants)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { meta: { total: 3, offset: 0, limit: 500 }, results: [grantArnsten, grantArnsten2, grantBreaker] },
    } as any);
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { meta: { total: 3, offset: 3, limit: 500 }, results: [] },
    } as any);

    const userModel = mockUserModel([]);
    const scraper = new NihReporterScraper({ userModel });
    const { ctx, emitted } = makeContext({ limit: 1 });
    const result = await scraper.run(ctx);

    // Only one PI should have been emitted observations for.
    const groupKeys = new Set(
      emitted
        .filter((o) => o.entityType === 'researchEntity')
        .map((o) => o.entityKey),
    );
    expect(groupKeys.size).toBe(1);
    expect(result.entitiesObserved).toBe(1);
  });

  it('rejects unsafe runtime limits before fetching NIH pages', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { meta: { total: 0, offset: 0, limit: 500 }, results: [] },
    } as any);
    const scraper = new NihReporterScraper({ userModel: mockUserModel([]) });
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(postSpy).not.toHaveBeenCalled();
  });
});
