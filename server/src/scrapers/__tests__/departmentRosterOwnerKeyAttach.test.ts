import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  rosterResearchEntitySlug,
  rosterResearchEntitySlugPrefix,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
  decideRosterAttach,
  rosterOwnerKeyIsAttachWitness,
  selectRosterAttachTarget,
  type RosterOwnerKeyRow,
} from '../rosterOwnerKeyRows';
import type { ObservationInput, ScraperContext } from '../types';

const ROSTER_A: DeptConfig = {
  deptKey: 'synthetic-alpha',
  deptName: 'Synthetic Alpha Studies',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: 'https://alpha-studies.yale.edu/people/faculty',
  paginated: false,
  extractor: () => [],
};
const ROSTER_B: DeptConfig = {
  deptKey: 'synthetic-beta',
  deptName: 'Synthetic Beta Studies',
  schoolName: 'Yale School of Synthetic Arts',
  url: 'https://beta-studies.yale.edu/faculty',
  paginated: false,
  extractor: () => [],
};

const PERSON: FacultyEntry = {
  name: 'Ada Alpha',
  title: 'Professor of Synthetic Studies',
  email: 'ada.alpha@yale.edu',
  labUrl: 'https://alpha-lab.example.org',
};
const OWNER_KEY = 'netid:ada.alpha';

const rowOn = (
  dept: DeptConfig,
  overrides: Partial<RosterOwnerKeyRow> = {},
): RosterOwnerKeyRow => ({
  id: `${dept.deptKey}-row`,
  slug: rosterResearchEntitySlug(PERSON, dept),
  rosterPrefix: rosterResearchEntitySlugPrefix(dept),
  createdAt: '2026-01-01T00:00:00.000Z',
  mintedFromRosterHost: new URL(dept.url).hostname,
  leadPrimaryIdentityUrls: [],
  ...overrides,
});

const decide = (
  dept: DeptConfig,
  rows: RosterOwnerKeyRow[],
  overrides: Partial<Parameters<typeof decideRosterAttach>[0]> = {},
) =>
  decideRosterAttach({
    ownerKey: OWNER_KEY,
    ownSlug: rosterResearchEntitySlug(PERSON, dept),
    ownRosterPrefix: rosterResearchEntitySlugPrefix(dept),
    personName: PERSON.name,
    rowsByOwnerKey: new Map([[OWNER_KEY, rows]]),
    mintedThisRun: new Map(),
    ...overrides,
  });

function makeContext() {
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
  return { ctx, emitted };
}

const runRosters = async (configs: DeptConfig[], rows: Map<string, RosterOwnerKeyRow[]>) => {
  const scraper = new DepartmentRosterScraper(
    configs.map((dept) => ({ ...dept, extractor: () => [{ ...PERSON }] })),
    null,
    vi.fn(async () => '<html><body></body></html>'),
    undefined,
    undefined,
    async () => rows,
  );
  const { ctx, emitted } = makeContext();
  await scraper.run(ctx);
  const researchKeys = new Set(
    emitted.filter((o) => o.entityType === 'researchEntity').map((o) => o.entityKey),
  );
  const snapshots = new Map(
    emitted
      .filter((o) => o.entityType === 'departmentRosterHealth')
      .map((o) => [o.entityKey, o.value as any]),
  );
  return { researchKeys, snapshots };
};

describe('one person on two rosters keeps one research row (#5969)', () => {
  it('admits only a person-specific mailbox key as the witness', () => {
    expect(rosterOwnerKeyIsAttachWitness(OWNER_KEY)).toBe(true);
    expect(rosterOwnerKeyIsAttachWitness('dept:synthetic-alpha:ada-alpha')).toBe(false);
    expect(rosterOwnerKeyIsAttachWitness('netid:registrar')).toBe(false);
    expect(rosterOwnerKeyIsAttachWitness('netid:synthetic.dus')).toBe(false);
    expect(rosterOwnerKeyIsAttachWitness('')).toBe(false);
  });

  it('attaches a second roster to the existing row instead of minting another', () => {
    expect(decide(ROSTER_B, [rowOn(ROSTER_A)])).toEqual({
      targetSlug: rowOn(ROSTER_A).slug,
      reason: 'attach-existing',
    });
  });

  it('never attaches through a role mailbox or a name-only key', () => {
    const shared = 'netid:registrar';
    expect(
      decide(ROSTER_B, [rowOn(ROSTER_A)], {
        ownerKey: shared,
        rowsByOwnerKey: new Map([[shared, [rowOn(ROSTER_A)]]]),
      }).reason,
    ).toBe('mint-own');
    const nameKey = 'dept:synthetic-beta:ada-alpha';
    expect(
      decide(ROSTER_B, [rowOn(ROSTER_A)], {
        ownerKey: nameKey,
        rowsByOwnerKey: new Map([[nameKey, [rowOn(ROSTER_A)]]]),
      }).reason,
    ).toBe('mint-own');
  });

  it('refuses when the address is shared by a differently named person on the other roster', () => {
    const otherPersonsRow = rowOn(ROSTER_A, {
      slug: `${rosterResearchEntitySlugPrefix(ROSTER_A)}bram-orlo`,
    });
    expect(decide(ROSTER_B, [otherPersonsRow]).reason).toBe('refused-name-disagrees');
  });

  it('picks the appointment roster when the lead profile names one, else the oldest row', () => {
    const onA = rowOn(ROSTER_A, { createdAt: '2026-03-01T00:00:00.000Z' });
    const onB = rowOn(ROSTER_B, { createdAt: '2026-01-01T00:00:00.000Z' });
    expect(selectRosterAttachTarget([onA, onB])?.slug).toBe(onB.slug);
    const profile = ['https://alpha-studies.yale.edu/profile/ada-alpha/'];
    expect(
      selectRosterAttachTarget([
        { ...onA, leadPrimaryIdentityUrls: profile },
        { ...onB, leadPrimaryIdentityUrls: profile },
      ])?.slug,
    ).toBe(onA.slug);
  });

  it('derives the same target from either roster, so running both again changes nothing', () => {
    const rows = [rowOn(ROSTER_A, { createdAt: '2025-01-01T00:00:00.000Z' }), rowOn(ROSTER_B)];
    const fromA = decide(ROSTER_A, rows);
    const fromB = decide(ROSTER_B, rows);
    expect(fromA).toEqual({ targetSlug: rows[0].slug, reason: 'mint-own' });
    expect(fromB).toEqual({ targetSlug: rows[0].slug, reason: 'attach-existing' });
    expect(decide(ROSTER_B, rows)).toEqual(fromB);
  });

  it('a second roster emits no row of its own and still lists both keys as discovered', async () => {
    const { researchKeys, snapshots } = await runRosters(
      [ROSTER_B],
      new Map([[OWNER_KEY, [rowOn(ROSTER_A)]]]),
    );
    expect([...researchKeys]).toEqual([]);
    const snapshot = snapshots.get(ROSTER_B.deptKey);
    expect(snapshot.discoveredEntityKeys).toEqual(
      expect.arrayContaining([rowOn(ROSTER_A).slug, rosterResearchEntitySlug(PERSON, ROSTER_B)]),
    );
    expect(snapshot.withdrawnEntityKeys ?? []).toEqual([]);
  });

  it('two rosters read in one run before either row exists mint one row', async () => {
    const { researchKeys } = await runRosters([ROSTER_A, ROSTER_B], new Map());
    expect(researchKeys.size).toBe(1);
  });

  it('still mints a row per roster for a person with no mailbox key', async () => {
    const scraper = new DepartmentRosterScraper(
      [ROSTER_A, ROSTER_B].map((dept) => ({
        ...dept,
        extractor: () => [{ ...PERSON, email: undefined }],
      })),
      null,
      vi.fn(async () => '<html><body></body></html>'),
      undefined,
      undefined,
      async () => new Map(),
    );
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);
    const keys = new Set(
      emitted.filter((o) => o.entityType === 'researchEntity').map((o) => o.entityKey),
    );
    expect(keys.size).toBe(2);
  });
});
