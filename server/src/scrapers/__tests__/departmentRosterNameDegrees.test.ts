import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  legacyRosterResearchEntitySlug,
  rosterEntryGivenNameIsACredential,
  rosterResearchEntitySlug,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import { decideLegacyKeyAdoption, type LegacyKeyRows } from '../rosterLegacyKeyAdoption';
import { normalizeName } from '../utils/scraperHelpers';
import { ROSTER_NAME_NORMALIZER_LEGACY_TOKENS } from '../../utils/degreeTokens';
import type { ObservationInput, ScraperContext } from '../types';

const DEPT: DeptConfig = {
  deptKey: 'synthetic-alpha',
  deptName: 'Synthetic Alpha Studies',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: 'https://alpha-studies.yale.edu/people/faculty',
  paginated: false,
  extractor: () => [],
};

const DEGREED: FacultyEntry = {
  name: 'Ada Alpha, BS',
  title: 'Professor of Synthetic Studies',
  email: 'ada.alpha@yale.edu',
  labUrl: 'https://alpha-lab.example.org',
};
const OWNER_KEY = 'netid:ada.alpha';

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

const runRoster = async (entry: FacultyEntry, rows: Map<string, LegacyKeyRows>) => {
  const scraper = new DepartmentRosterScraper(
    [{ ...DEPT, extractor: () => [{ ...entry }] }],
    null,
    vi.fn(async () => '<html><body></body></html>'),
    undefined,
    undefined,
    async () => new Map(),
    undefined,
    async () => rows,
  );
  const { ctx, emitted } = makeContext();
  await scraper.run(ctx);
  return {
    research: emitted.filter((o) => o.entityType === 'researchEntity'),
    users: emitted.filter((o) => o.entityType === 'user'),
    snapshot: emitted.find((o) => o.entityType === 'departmentRosterHealth')?.value as any,
  };
};

const legacyRow = (overrides: Partial<LegacyKeyRows> = {}): LegacyKeyRows => ({
  liveRowIds: ['existing-row'],
  rosterOwnerKeys: [OWNER_KEY],
  readByThisLane: true,
  ...overrides,
});

describe('one degree list for names and profile slugs (#5969)', () => {
  it('strips a bachelor’s or nursing credential from a roster name, and v1 kept it', () => {
    expect(normalizeName('Ada Alpha, BS')).toBe('Ada Alpha');
    expect(normalizeName('Ada Alpha, PhD, APRN, FNP-C')).toBe('Ada Alpha');
    expect(normalizeName('Ada Alpha, M.D., Ph.D.')).toBe('Ada Alpha');
    expect(normalizeName('Ada Alpha, BS', ROSTER_NAME_NORMALIZER_LEGACY_TOKENS.v1)).toBe(
      'Ada Alpha, BS',
    );
    expect(normalizeName('Ada Alpha, MD', ROSTER_NAME_NORMALIZER_LEGACY_TOKENS.v1)).toBe(
      'Ada Alpha',
    );
  });

  it('derives the earlier key explicitly by version', () => {
    expect(rosterResearchEntitySlug(DEGREED, DEPT)).toBe('dept-synthetic-alpha-ada-alpha');
    expect(legacyRosterResearchEntitySlug(DEGREED, DEPT, 'v1')).toBe(
      'dept-synthetic-alpha-ada-alpha-bs',
    );
    expect(legacyRosterResearchEntitySlug({ name: 'Ada Alpha' }, DEPT)).toBe(
      rosterResearchEntitySlug({ name: 'Ada Alpha' }, DEPT),
    );
  });
});

describe('a normalizer change keeps writing to the row the old key holds (#5969)', () => {
  const decide = (rows: Map<string, LegacyKeyRows>, ownerKey = OWNER_KEY) =>
    decideLegacyKeyAdoption({
      currentSlug: 'dept-synthetic-alpha-ada-alpha',
      legacySlug: 'dept-synthetic-alpha-ada-alpha-bs',
      ownerKey,
      legacyOwnerKey: ownerKey,
      rowsBySlug: rows,
    });

  it('adopts the one row this lane read under the old key for the same person, with no second row', async () => {
    const rows = new Map([['dept-synthetic-alpha-ada-alpha-bs', legacyRow()]]);
    const { research } = await runRoster(DEGREED, rows);
    expect(new Set(research.map((o) => o.entityKey))).toEqual(
      new Set(['dept-synthetic-alpha-ada-alpha-bs']),
    );
    expect(new Set(research.map((o) => o.entityId))).toEqual(new Set(['existing-row']));
    expect(research.find((o) => o.field === 'slug')?.value).toBe(
      'dept-synthetic-alpha-ada-alpha-bs',
    );
    expect(research.find((o) => o.field === 'name')?.value).not.toMatch(/BS/);
  });

  it('derives the same adoption on a second run', async () => {
    const rows = new Map([['dept-synthetic-alpha-ada-alpha-bs', legacyRow()]]);
    const first = await runRoster(DEGREED, rows);
    const second = await runRoster(DEGREED, rows);
    expect(second.research).toEqual(first.research);
  });

  it('refuses, and mints nothing, when the old key’s row was read for a different person', async () => {
    const rows = new Map([
      ['dept-synthetic-alpha-ada-alpha-bs', legacyRow({ rosterOwnerKeys: ['netid:bram.orlo'] })],
    ]);
    expect(decide(rows).kind).toBe('refuse');
    const { research, snapshot } = await runRoster(DEGREED, rows);
    expect(research).toEqual([]);
    expect(snapshot.withdrawnEntityKeys ?? []).toEqual([]);
  });

  it('refuses when two rows answer to the old key', async () => {
    const rows = new Map([
      ['dept-synthetic-alpha-ada-alpha-bs', legacyRow({ liveRowIds: ['row-a', 'row-b'] })],
    ]);
    expect(decide(rows)).toMatchObject({ kind: 'refuse', reason: 'several-rows' });
    expect((await runRoster(DEGREED, rows)).research).toEqual([]);
  });

  it('never adopts a row another source holds under that key', async () => {
    const rows = new Map([
      [
        'dept-synthetic-alpha-ada-alpha-bs',
        legacyRow({ readByThisLane: false, rosterOwnerKeys: [] }),
      ],
    ]);
    expect(decide(rows)).toMatchObject({ kind: 'refuse', reason: 'another-source' });
    expect((await runRoster(DEGREED, rows)).research).toEqual([]);
  });

  it('mints under the new key when no row answers to the old one, or one already holds the new key', async () => {
    expect(decide(new Map()).kind).toBe('none');
    expect(
      decide(
        new Map([
          ['dept-synthetic-alpha-ada-alpha', legacyRow({ liveRowIds: ['new-key-row'] })],
          ['dept-synthetic-alpha-ada-alpha-bs', legacyRow()],
        ]),
      ).kind,
    ).toBe('none');
    const { research } = await runRoster(DEGREED, new Map());
    expect(new Set(research.map((o) => o.entityKey))).toEqual(
      new Set(['dept-synthetic-alpha-ada-alpha']),
    );
  });
});

describe('a credential in the given-name position names no person (#5969)', () => {
  it('reads a credential written as one, and keeps a given name spelled like one', () => {
    expect(rosterEntryGivenNameIsACredential({ name: 'PhD Alpha' })).toBe(true);
    expect(rosterEntryGivenNameIsACredential({ name: 'MD Alpha' })).toBe(true);
    expect(rosterEntryGivenNameIsACredential({ name: 'Ph.D. Alpha' })).toBe(true);
    expect(rosterEntryGivenNameIsACredential({ name: 'Ma Alpha' })).toBe(false);
    expect(rosterEntryGivenNameIsACredential({ name: 'Do Alpha' })).toBe(false);
    expect(rosterEntryGivenNameIsACredential({ name: 'Alpha' })).toBe(false);
  });

  it('mints no person and no research row from such an entry', async () => {
    const { research, users } = await runRoster(
      { name: 'PhD Alpha', title: 'Professor', labUrl: 'https://alpha-lab.example.org' },
      new Map(),
    );
    expect(research).toEqual([]);
    expect(users).toEqual([]);
  });

  it('still mints for a real given name that is spelled like a credential', async () => {
    const { research } = await runRoster(
      { name: 'Ma Alpha', title: 'Professor', labUrl: 'https://alpha-lab.example.org' },
      new Map(),
    );
    expect(research.length).toBeGreaterThan(0);
  });
});
