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

const ACCESS_OR_CONTACT_ARTIFACT_FIELDS = new Set([
  'acceptingUndergrads',
  'undergradAccessEvidence',
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'undergradConstraintQuote',
  'contactInstructionsQuote',
  'joinPageUrl',
  'contactName',
  'contactEmail',
  'contactRole',
  'currentUndergradCount',
  'pastUndergradAdvisees',
  'offersIndependentStudy',
  'independentStudyCourses',
]);

function expectNoAccessOrContactArtifacts(obs: ObservationInput[]) {
  const artifactFields = obs
    .filter((o) => ACCESS_OR_CONTACT_ARTIFACT_FIELDS.has(o.field))
    .map((o) => o.field);
  expect(artifactFields).toEqual([]);
}

// ---------------------------------------------------------------------------
// Sample fixtures (shape matches a real NIH RePORTER `results[i]` record)
// ---------------------------------------------------------------------------

const grantAvery: NihGrant = {
  project_num: '5R01MH123456-03',
  appl_id: 11000001,
  core_project_num: 'R01MH123456',
  project_title: 'Prefrontal cortex circuits in cognitive aging',
  abstract_text: 'We will study PFC circuit dynamics in aging primates.',
  contact_pi_name: 'STONE, AVERY F',
  principal_investigators: [
    {
      profile_id: 1,
      first_name: 'Avery',
      last_name: 'Stone',
      full_name: 'Avery F Stone',
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

const grantAvery2: NihGrant = {
  ...grantAvery,
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

const grantBlake: NihGrant = {
  project_num: '1R35GM222222-01',
  appl_id: 12000001,
  project_title: 'Riboswitch discovery and bacterial gene control',
  abstract_text: '',
  contact_pi_name: 'REED, BLAKE R',
  principal_investigators: [
    {
      profile_id: 2,
      first_name: 'Blake',
      last_name: 'Reed',
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
    expect(canonicalPiName('STONE, AVERY F')).toBe('Avery Stone');
    expect(canonicalPiName('REED, BLAKE R')).toBe('Blake Reed');
  });

  it('passes through already-natural-order names with title casing for ALL CAPS', () => {
    expect(canonicalPiName('AVERY STONE')).toBe('Avery Stone');
  });

  it('returns empty string on falsy input', () => {
    expect(canonicalPiName('')).toBe('');
    expect(canonicalPiName(null)).toBe('');
    expect(canonicalPiName(undefined)).toBe('');
  });
});

describe('piEntityKey / piSlugForResearchGroup', () => {
  it('produces a deterministic, slug-friendly key per PI', () => {
    expect(piEntityKey('Avery Stone')).toBe('nih-pi:avery-stone');
    expect(piSlugForResearchGroup('Avery Stone')).toBe('nih-pi-avery-stone');
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
    expect(pickContactPiName(grantAvery)).toBe('Avery Stone');
  });

  it('falls back to contact_pi_name when no structured PI is marked contact', () => {
    const grant: NihGrant = {
      ...grantAvery,
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
    const groups = groupGrantsByPi([grantAvery, grantAvery2, grantBlake]);
    expect(groups.size).toBe(2);
    expect(groups.get('Avery Stone')).toHaveLength(2);
    expect(groups.get('Blake Reed')).toHaveLength(1);
  });

  it('drops grants with no resolvable contact PI', () => {
    const groups = groupGrantsByPi([grantAvery, grantOrphan]);
    expect(groups.size).toBe(1);
    expect(groups.has('Avery Stone')).toBe(true);
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
    const rec = grantToRecord(grantAvery);
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
    expect(await findUserForPi('Avery Stone', um)).toBeNull();
  });

  it('returns the unique candidate when there is exactly one surname match', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Avery', lname: 'Stone', netid: 'as1' },
    ]);
    expect(await findUserForPi('Avery Stone', um)).toMatchObject({ _id: 'u1', netid: 'as1' });
  });

  it('disambiguates by exact first name when surname has multiple hits', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Avery', lname: 'Stone', netid: 'as1' },
      { _id: 'u2', fname: 'John', lname: 'Stone', netid: 'js1' },
    ]);
    expect(await findUserForPi('Avery Stone', um)).toMatchObject({ _id: 'u1', netid: 'as1' });
  });

  it('falls back to safe first-name prefix match when exact fname fails', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amelia', lname: 'Stone', netid: 'avx1' },
      { _id: 'u2', fname: 'John', lname: 'Stone', netid: 'js1' },
    ]);
    expect(await findUserForPi('Ame Stone', um)).toMatchObject({ _id: 'u1', netid: 'avx1' });
  });

  it('does not match unrelated full first names that share only an initial', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Milo', lname: 'Morgan', netid: 'mm1' },
    ]);
    expect(await findUserForPi('Mara Rivera Morgan', um)).toBeNull();
  });

  it('returns null when ambiguity remains after first-initial fallback', async () => {
    const um = mockUserModel([
      { _id: 'u1', fname: 'Amelia', lname: 'Stone', netid: 'avx1' },
      { _id: 'u2', fname: 'Anne', lname: 'Stone', netid: 'ans1' },
    ]);
    expect(await findUserForPi('Avery Stone', um)).toBeNull();
  });

  it('ignores synthetic funding-only user stubs', async () => {
    const um = mockUserModel([
      { _id: 'stub', fname: 'Avery', lname: 'Stone', netid: 'nih-pi:avery-stone' },
    ]);
    expect(await findUserForPi('Avery Stone', um)).toBeNull();
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
  it('keeps unmatched funding PIs out of canonical user identity observations', () => {
    const obs = piGrantsToObservations('External Collaborator', [grantAvery], null);

    expect(obs).toEqual([]);
  });

  it('does not emit research-entity grant observations when no Yale user is matched', () => {
    const obs = piGrantsToObservations('Avery Stone', [grantAvery, grantAvery2], null);

    expect(obs).toEqual([]);
  });

  it('skips the user observation block and emits inferredPiUserId when matched', () => {
    const obs = piGrantsToObservations(
      'Blake Reed',
      [grantBlake],
      {
        _id: 'user-abc',
        netid: 'br1',
      },
      { slug: 'reed-lab', createIfMissing: false },
    );
    expect(obs.filter((o) => o.entityType === 'user')).toHaveLength(0);
    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    expect(groupObs.every((o) => o.entityKey === 'reed-lab')).toBe(true);
    expect(groupObs.find((o) => o.field === 'slug')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'name')).toBeUndefined();
    const piId = groupObs.find((o) => o.field === 'inferredPiUserId');
    expect(piId?.value).toBe('user-abc');
    expect(piId?.confidenceOverride).toBeGreaterThanOrEqual(0.8);
    expect(groupObs.find((o) => o.field === 'inferredPiUserKey')).toBeUndefined();
  });

  it('truncates recentGrants to the configured cap', () => {
    const many: NihGrant[] = Array.from({ length: 20 }, (_v, i) => ({
      ...grantAvery,
      project_num: `R01-${i}`,
      appl_id: 20000000 + i,
      project_start_date: `2024-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00`,
    }));
    const obs = piGrantsToObservations(
      'Avery Stone',
      many,
      {
        _id: 'user-avery',
        netid: 'as1',
      },
      { slug: 'stone-lab', createIfMissing: false },
    );
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
    expect(piGrantsToObservations('', [grantAvery], null)).toEqual([]);
    expect(piGrantsToObservations('Avery Stone', [], null)).toEqual([]);
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
      // Page 1 returns 2 grants for Stone + 1 for Reed; page 2 returns empty.
      if (offset === 0) {
        return {
          data: { meta: { total: 3, offset: 0, limit: 500 }, results: [grantAvery, grantAvery2, grantBlake] },
        } as any;
      }
      return { data: { meta: { total: 3, offset, limit: 500 }, results: [] } } as any;
    });

    // Match Reed but not Stone.
    const userModel = {
      find: vi.fn((query: any) => ({
        limit: () => ({
          lean: async () => {
            // The query includes a regex on lname; we just check the source string.
            const src: string = query.lname?.source || '';
            if (/Reed/i.test(src)) {
              return [{ _id: 'reed-id', fname: 'Blake', lname: 'Reed', netid: 'br1' }];
            }
            return [];
          },
        }),
      })) as any,
    };

    const researchEntityTargetFinder = vi.fn(async () => ({
      slug: 'reed-lab',
      createIfMissing: false,
    }));
    const scraper = new NihReporterScraper({ userModel, researchEntityTargetFinder });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(postSpy).toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(2); // 2 unique PIs
    expect(result.notes).toContain('matched 1');
    expect(result.notes).toContain('unmatched 1');

    // Stone unmatched → no user obs from funding identity alone
    const averyUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:avery-stone',
    );
    expect(averyUserObs).toEqual([]);

    // Reed matched → no user obs
    const blakeUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:blake-reed',
    );
    expect(blakeUserObs).toHaveLength(0);

    // Unmatched PI should not mint a student-facing research profile.
    const averyGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-avery-stone',
    );
    expect(averyGroup).toEqual([]);

    const blakeGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'reed-lab',
    );
    expect(blakeGroup.find((o) => o.field === 'inferredPiUserId')?.value).toBe('reed-id');
    expect(blakeGroup.find((o) => o.field === 'slug')).toBeUndefined();
  });

  it('honors the limit option (caps PIs processed, not raw grants)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { meta: { total: 3, offset: 0, limit: 500 }, results: [grantAvery, grantAvery2, grantBlake] },
    } as any);
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { meta: { total: 3, offset: 3, limit: 500 }, results: [] },
    } as any);

    const userModel = mockUserModel([]);
    const scraper = new NihReporterScraper({ userModel });
    const { ctx, emitted } = makeContext({ limit: 1 });
    const result = await scraper.run(ctx);

    // Only one PI is processed, but unmatched PIs no longer mint profile rows.
    const groupKeys = new Set(
      emitted
        .filter((o) => o.entityType === 'researchEntity')
        .map((o) => o.entityKey),
    );
    expect(groupKeys.size).toBe(0);
    expect(result.entitiesObserved).toBe(1);
  });
});
