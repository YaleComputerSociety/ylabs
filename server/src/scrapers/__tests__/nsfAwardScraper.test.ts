/**
 * Unit tests for NsfAwardScraper.
 *
 * No network, no Mongo — the NSF API and User finder are both injected as
 * dependencies via the scraper's constructor / helper signatures, so the tests
 * exercise the full run() path (pagination, grouping, matching, observation
 * emission) deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  NsfAwardScraper,
  awardToRecord,
  findUserForPi,
  groupAwardsByPi,
  maxStartDate,
  parseCoPdpiLine,
  parseDollarAmount,
  parseNsfDate,
  piDisplayName,
  piGroupKey,
  piSlug,
  sortGrantsByRecency,
  type NsfAward,
} from '../sources/nsfAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

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
// Fixtures
// ---------------------------------------------------------------------------

const STONE_AWARD: NsfAward = {
  id: '2535171',
  title: 'NSF-ANR CHE: Insights into Alkene Hydrofunctionalization',
  abstractText: 'Catalysis project for sustainability.',
  awardeeName: 'Yale University',
  pdPIName: 'Avery L Stone',
  piFirstName: 'Avery',
  piLastName: 'Stone',
  piMiddeInitial: 'L',
  piEmail: 'fixture.avery.stone@yale.edu',
  pi: ['Avery L Stone fixture.avery.stone@yale.edu'],
  startDate: '01/01/2026',
  expDate: '12/31/2029',
  fundsObligatedAmt: '650151',
  estimatedTotalAmt: '650151',
  fundProgramName: 'PROJECTS',
  agency: 'NSF',
  activeAwd: 'true',
};

const STONE_AWARD_2: NsfAward = {
  ...STONE_AWARD,
  id: '2200001',
  title: 'Earlier Stone award',
  startDate: '07/01/2022',
  expDate: '06/30/2025',
  fundsObligatedAmt: '300000',
};

const QUILL_AWARD: NsfAward = {
  id: '2510152',
  title: 'Co-PI award with Yale collaborators',
  abstractText: 'Multi-institution collaboration.',
  awardeeName: 'Yale University',
  pdPIName: 'Jordan Quill',
  piFirstName: 'Jordan',
  piLastName: 'Quill',
  pi: ['Jordan Quill jordan.quill@example.edu'],
  coPDPI: [
    'Morgan Lee fixture.morgan.lee@yale.edu',
    'Taylor R Kim fixture.taylor.kim@yale.edu',
    'Casey Morgan casey.morgan@example.edu',
  ],
  startDate: '08/01/2024',
  expDate: '07/31/2027',
  fundsObligatedAmt: '500000',
  agency: 'NSF',
};

const REED_AWARD: NsfAward = {
  id: '2531367',
  title: 'Bacterial biofilms',
  awardeeName: 'Yale University',
  pdPIName: 'Riley Reed',
  piFirstName: 'Riley',
  piLastName: 'Reed',
  pi: ['Riley Reed fixture.riley.reed@yale.edu'],
  startDate: '03/01/2025',
  expDate: '02/28/2028',
  fundsObligatedAmt: '275000',
  agency: 'NSF',
};

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('parseNsfDate', () => {
  it('parses mm/dd/yyyy', () => {
    expect(parseNsfDate('01/15/2024')?.toISOString().slice(0, 10)).toBe('2024-01-15');
  });
  it('returns undefined for blank or malformed', () => {
    expect(parseNsfDate('')).toBeUndefined();
    expect(parseNsfDate(null)).toBeUndefined();
    expect(parseNsfDate(undefined)).toBeUndefined();
    expect(parseNsfDate('not-a-date')).toBeUndefined();
    expect(parseNsfDate('2024-01-15')).toBeUndefined(); // wrong format
  });
});

describe('parseDollarAmount', () => {
  it('parses plain number strings', () => {
    expect(parseDollarAmount('650151')).toBe(650151);
  });
  it('strips commas and dollar signs', () => {
    expect(parseDollarAmount('$1,234,567')).toBe(1234567);
  });
  it('returns undefined for blanks', () => {
    expect(parseDollarAmount('')).toBeUndefined();
    expect(parseDollarAmount(null)).toBeUndefined();
    expect(parseDollarAmount(undefined)).toBeUndefined();
  });
});

describe('piDisplayName', () => {
  it('joins first + last', () => {
    expect(piDisplayName(STONE_AWARD)).toBe('Avery Stone');
  });
  it('falls back to pdPIName if first/last are missing', () => {
    expect(piDisplayName({ pdPIName: 'Just Pdpi' })).toBe('Just Pdpi');
  });
  it('returns empty string when nothing usable', () => {
    expect(piDisplayName({})).toBe('');
  });
});

describe('piGroupKey', () => {
  it('produces a stable lowercase key', () => {
    expect(piGroupKey('Avery', 'Stone')).toBe('avery stone');
    expect(piGroupKey('AVERY', 'STONE')).toBe('avery stone');
  });
  it('handles missing first name', () => {
    expect(piGroupKey('', 'Stone')).toBe('stone');
  });
  it('returns "unknown" when both blank', () => {
    expect(piGroupKey('', '')).toBe('unknown');
  });
});

describe('groupAwardsByPi', () => {
  it('groups awards from the same PI together', () => {
    const groups = groupAwardsByPi([STONE_AWARD, STONE_AWARD_2, REED_AWARD]);
    expect(groups).toHaveLength(2);
    const stone = groups.find((g) => g.piLastName === 'Stone');
    expect(stone).toBeDefined();
    expect(stone!.awards).toHaveLength(2);
    const stoneIds = stone!.awards.map((a) => a.id).sort();
    expect(stoneIds).toEqual(['2200001', '2535171']);
    const reed = groups.find((g) => g.piLastName === 'Reed');
    expect(reed!.awards).toHaveLength(1);
  });

  it('drops awards with no PI name', () => {
    const groups = groupAwardsByPi([
      { id: 'x', awardeeName: 'Yale University' },
      STONE_AWARD,
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].piLastName).toBe('Stone');
  });

  it('case-insensitive grouping (key normalized)', () => {
    const a: NsfAward = { ...STONE_AWARD, id: 'a', piFirstName: 'AVERY' };
    const b: NsfAward = { ...STONE_AWARD, id: 'b', piFirstName: 'avery' };
    const groups = groupAwardsByPi([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].awards).toHaveLength(2);
  });
});

describe('awardToRecord', () => {
  it('normalizes an NSF award into a recentGrants subdocument', () => {
    const rec = awardToRecord(STONE_AWARD);
    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('2535171');
    expect(rec!.agency).toBe('NSF');
    expect(rec!.title).toMatch(/Hydrofunctionalization/);
    expect(rec!.dollarAmount).toBe(650151);
    expect(rec!.startDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(rec!.endDate?.toISOString().slice(0, 10)).toBe('2029-12-31');
    expect(rec!.url).toBe('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171');
    expect(rec!.role).toBe('pi');
  });

  it('falls back to estimatedTotalAmt when fundsObligatedAmt is missing', () => {
    const rec = awardToRecord({ ...STONE_AWARD, fundsObligatedAmt: undefined });
    expect(rec!.dollarAmount).toBe(650151);
  });

  it('returns null when id is missing', () => {
    expect(awardToRecord({ ...STONE_AWARD, id: undefined })).toBeNull();
  });

  it('honors a copi role override', () => {
    const rec = awardToRecord(STONE_AWARD, 'copi');
    expect(rec!.role).toBe('copi');
  });
});

describe('sortGrantsByRecency', () => {
  it('sorts most-recent-first by startDate', () => {
    const records = [STONE_AWARD_2, STONE_AWARD, REED_AWARD]
      .map((a) => awardToRecord(a)!)
      .filter(Boolean);
    const sorted = sortGrantsByRecency(records);
    expect(sorted.map((r) => r.id)).toEqual(['2535171', '2531367', '2200001']);
  });
  it('sinks records without a start date to the end', () => {
    const records = [
      awardToRecord(STONE_AWARD)!,
      awardToRecord({ ...REED_AWARD, startDate: undefined })!,
    ];
    const sorted = sortGrantsByRecency(records);
    expect(sorted[0].id).toBe('2535171');
    expect(sorted[1].id).toBe('2531367');
  });
});

describe('maxStartDate', () => {
  it('returns the latest startDate', () => {
    const d = maxStartDate([STONE_AWARD_2, STONE_AWARD, REED_AWARD]);
    expect(d?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
  it('returns undefined when no awards have a start date', () => {
    expect(maxStartDate([{ id: 'x', startDate: undefined }])).toBeUndefined();
  });
});

describe('parseCoPdpiLine', () => {
  it('extracts name + email when both are present', () => {
    expect(parseCoPdpiLine('Morgan Lee fixture.morgan.lee@yale.edu')).toEqual({
      fullName: 'Morgan Lee',
      email: 'fixture.morgan.lee@yale.edu',
    });
  });
  it('handles middle initials in name', () => {
    expect(parseCoPdpiLine('Taylor R Kim fixture.taylor.kim@yale.edu')).toEqual({
      fullName: 'Taylor R Kim',
      email: 'fixture.taylor.kim@yale.edu',
    });
  });
  it('handles a name-only line (no email)', () => {
    expect(parseCoPdpiLine('Just Name')).toEqual({ fullName: 'Just Name' });
  });
  it('returns null for blanks', () => {
    expect(parseCoPdpiLine('')).toBeNull();
    expect(parseCoPdpiLine('   ')).toBeNull();
  });
});

describe('piSlug', () => {
  it('uses user id when matched', () => {
    expect(piSlug('507f1f77bcf86cd799439011', 'Avery', 'Stone')).toBe(
      'nsf-pi-507f1f77bcf86cd799439011',
    );
  });
  it('falls back to a name-based slug when unmatched', () => {
    expect(piSlug(null, 'Avery', 'Stone')).toBe('nsf-pi-avery-stone');
  });
  it('caps slug length at 100 chars', () => {
    const slug = piSlug(null, 'A'.repeat(80), 'B'.repeat(80));
    expect(slug.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// findUserForPi (with injected finder; no Mongo)
// ---------------------------------------------------------------------------

describe('findUserForPi', () => {
  it('returns the matched user id on exact lname+fname', async () => {
    const finder = vi.fn(async () => [{ _id: 'user-1' }]);
    const user = await findUserForPi(
      { firstName: 'Avery', lastName: 'Stone' },
      finder as any,
    );
    expect(user).toMatchObject({ _id: 'user-1' });
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('falls back to lname + first initial when exact misses', async () => {
    const finder = vi
      .fn()
      .mockResolvedValueOnce([]) // exact miss
      .mockResolvedValueOnce([{ _id: 'user-2', fname: 'Avery' }]); // safe prefix hit
    const user = await findUserForPi({ firstName: 'Ave', lastName: 'Stone' }, finder as any);
    expect(user).toMatchObject({ _id: 'user-2' });
    expect(finder).toHaveBeenCalledTimes(2);
  });

  it('does not match unrelated full first names that share only an initial', async () => {
    const finder = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'user-milo', fname: 'Milo', lname: 'Morgan' }]);
    const user = await findUserForPi(
      { firstName: 'Mara Rivera', lastName: 'Morgan' },
      finder as any,
    );
    expect(user).toBeNull();
  });

  it('returns null on ambiguous exact match (multiple)', async () => {
    const finder = vi.fn(async () => [{ _id: 'a' }, { _id: 'b' }]);
    const user = await findUserForPi({ firstName: 'John', lastName: 'Smith' }, finder as any);
    expect(user).toBeNull();
    // does NOT fall through to initial when exact is ambiguous
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('returns null when no last name', async () => {
    const finder = vi.fn();
    const user = await findUserForPi({ firstName: 'X', lastName: '' }, finder as any);
    expect(user).toBeNull();
    expect(finder).not.toHaveBeenCalled();
  });

  it('ignores synthetic funding-only user stubs', async () => {
    const finder = vi.fn(async () => [{ _id: 'stub-1', netid: 'nsf-pi:avery stone' }]);
    const user = await findUserForPi(
      { firstName: 'Avery', lastName: 'Stone' },
      finder as any,
    );
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full run() — paginated, with mocked NSF API + User finder
// ---------------------------------------------------------------------------

function buildContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'nsf-award-search',
    sourceWeight: 0.9,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (input) => {
      const arr = Array.isArray(input) ? input : [input];
      for (const o of arr) emitted.push(o);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

describe('NsfAwardScraper.run', () => {
  it('paginates until an empty page is returned', async () => {
    // Build a single full page (PAGE_SIZE=25 in source), then a short page,
    // then would be empty. Two pages worth of distinct PIs.
    const page1 = Array.from({ length: 25 }, (_v, i) => ({
      ...REED_AWARD,
      id: `p1-${i}`,
      piFirstName: 'PiFirst' + i,
      piLastName: 'PiLast' + i,
    }));
    const page2 = [STONE_AWARD]; // short page → stop after this
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: page1, totalCount: 26 })
      .mockResolvedValueOnce({ awards: page2, totalCount: 26 });

    const userFinder = vi.fn(async () => []); // no user matches

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(26); // 26 distinct PIs
    expect(emitted).toEqual([]);
    expect(logs.some((l) => /totalCount=26/.test(l))).toBe(true);
  });

  it('groups multiple awards by the same PI into one ResearchGroup observation set', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      awards: [STONE_AWARD, STONE_AWARD_2, REED_AWARD],
    });
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2); // Stone + Reed
    expect(emitted).toEqual([]);
  });

  it('enriches an existing PI-led research entity for matched Yale users', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      awards: [STONE_AWARD, STONE_AWARD_2],
    });
    const userFinder = vi.fn(async () => [{ _id: 'user-stone', netid: 'as1' }]);
    const researchEntityTargetFinder = vi.fn(async () => ({
      slug: 'dept-chemistry-avery-stone',
      createIfMissing: false,
    }));

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      researchEntityTargetFinder,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);

    // Stone's ResearchGroup observations
    const stoneRg = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'dept-chemistry-avery-stone',
    );
    expect(stoneRg.find((o) => o.field === 'slug')).toBeUndefined();
    expect(stoneRg.find((o) => o.field === 'name')).toBeUndefined();
    const grants = stoneRg.find((o) => o.field === 'recentGrants')?.value as Array<{
      id: string;
    }>;
    expect(Array.isArray(grants)).toBe(true);
    expect(grants).toHaveLength(2);
    // Sorted recency — newer (2026 start) first
    expect(grants[0].id).toBe('2535171');
    expect(grants[1].id).toBe('2200001');

    const grantCount = stoneRg.find((o) => o.field === 'recentGrantCount')?.value;
    expect(grantCount).toBe(2);

    const fundingAgencies = stoneRg.find((o) => o.field === 'fundingAgencies')?.value;
    expect(fundingAgencies).toEqual(['NSF']);
    expect(stoneRg.find((o) => o.field === 'sourceUrls')?.value).toEqual([
      'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171',
      'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2200001',
    ]);

    const lastObserved = stoneRg.find((o) => o.field === 'lastObservedAt')?.value as Date;
    expect(lastObserved.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('does not emit grant observations when PI is unmatched', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [STONE_AWARD] });
    const userFinder = vi.fn(async () => []); // no match
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs).toEqual([]);
    expect(emitted.filter((o) => o.field === 'email')).toEqual([]);

    expect(emitted).toEqual([]);
  });

  it('keeps unmatched funding PIs out of canonical user identity and contact artifacts', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [STONE_AWARD] });
    const userFinder = vi.fn(async () => []);
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    expect(emitted.filter((o) => o.entityType === 'user')).toEqual([]);
    expectNoAccessOrContactArtifacts(emitted);
    expect(
      emitted.find(
        (o) =>
          o.entityType === 'researchEntity' &&
          (o.field === 'inferredPiUserId' || o.field === 'inferredPiUserKey'),
      ),
    ).toBeUndefined();
  });

  it('does not mint a funding profile when matched faculty has no target entity', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [STONE_AWARD] });
    const userFinder = vi.fn(async () => [{ _id: 'user-stone' }]);
    const researchEntityTargetFinder = vi.fn(async () => null);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      researchEntityTargetFinder,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    expect(emitted).toEqual([]);
  });

  it('can create a funding profile only after target policy marks the match high signal', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [STONE_AWARD] });
    const userFinder = vi.fn(async () => [{ _id: 'user-stone', netid: 'as1' }]);
    const researchEntityTargetFinder = vi.fn(async () => ({
      slug: 'nsf-pi-user-stone',
      createIfMissing: true,
    }));

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      researchEntityTargetFinder,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const rgObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(rgObs.find((o) => o.field === 'slug')?.value).toBe('nsf-pi-user-stone');
    expect(rgObs.find((o) => o.field === 'inferredPiUserId')?.value).toBe('user-stone');
    const inferredObs = rgObs.find((o) => o.field === 'inferredPiUserId');
    expect(inferredObs?.confidenceOverride).toBe(0.7);
  });

  it('emits ResearchGroupMember observations only for co-PIs that match Yale Users', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [QUILL_AWARD] });

    // Sequence of finder calls expected:
    //   (a) PI lookup: Quill — exact match → user-main.
    //   (b) co-PI Morgan Lee — exact match → user-morgan.
    //   (c) co-PI Taylor R Kim — exact match → user-taylor.
    //   (d) co-PI Casey Morgan — exact miss → [].
    //   (e) co-PI Casey Morgan — initial miss → [].
    const userFinder = vi
      .fn()
      .mockResolvedValueOnce([{ _id: 'user-main' }]) // (a)
      .mockResolvedValueOnce([{ _id: 'user-morgan' }]) // (b)
      .mockResolvedValueOnce([{ _id: 'user-taylor' }]) // (c)
      .mockResolvedValueOnce([]) // (d)
      .mockResolvedValueOnce([]); // (e)
    const researchEntityTargetFinder = vi.fn(async () => ({
      slug: 'quill-lab',
      createIfMissing: false,
    }));

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      researchEntityTargetFinder,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    // Two matched co-PIs × 4 fields each (researchGroupSlug, userId, role, fullName) + email when present
    const userIds = memberObs.filter((o) => o.field === 'userId').map((o) => o.value);
    expect(userIds.sort()).toEqual(['user-morgan', 'user-taylor']);

    const roles = memberObs.filter((o) => o.field === 'role').map((o) => o.value);
    expect(roles.every((r) => r === 'co-pi')).toBe(true);

    // Each matched co-PI should have an email observation (both have @yale.edu emails)
    const emails = memberObs.filter((o) => o.field === 'email').map((o) => o.value);
    expect(emails).toContain('fixture.morgan.lee@yale.edu');
    expect(emails).toContain('fixture.taylor.kim@yale.edu');
    // Non-Yale co-PI should NOT appear
    expect(
      emails.find((e) => typeof e === 'string' && (e as string).includes('example.edu')),
    ).toBeUndefined();

    const emailObservations = emitted.filter((o) => o.field === 'email');
    expect(emailObservations.every((o) => o.entityType === 'researchGroupMember')).toBe(true);
    expectNoAccessOrContactArtifacts(emitted);
  });

  it('respects ctx.options.limit by capping awards mid-page', async () => {
    const page = Array.from({ length: 25 }, (_v, i) => ({
      ...REED_AWARD,
      id: `lim-${i}`,
      piFirstName: 'Pi' + i,
      piLastName: 'Last' + i,
    }));
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: page, totalCount: 25 });
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx } = buildContext({ limit: 3 });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(3); // 3 PIs because each award is a distinct PI
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('aborts pagination cleanly on a network error mid-stream', async () => {
    const page1 = Array.from({ length: 25 }, (_v, i) => ({
      ...REED_AWARD,
      id: `e-${i}`,
      piFirstName: 'E' + i,
      piLastName: 'Last' + i,
    }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: page1, totalCount: 100 })
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(25); // first page processed
    expect(emitted).toEqual([]);
    expect(logs.some((l) => /ECONNRESET|aborting/i.test(l))).toBe(true);
  });
});
