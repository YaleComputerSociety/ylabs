import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  rosterMintWithdrawnEntityKey,
  rosterResearchEntitySlug,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import type { ObservationInput, ScraperContext } from '../types';

const DEPT: DeptConfig = {
  deptKey: 'synthetic-studies',
  deptName: 'Synthetic Studies',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: 'https://synthetic.yale.edu/people/faculty',
  paginated: false,
  extractor: () => [],
};

const profileHtml = (name: string) =>
  `<html><head><title>${name}</title></head><body><h1>${name}</h1><p>Office hours by appointment.</p></body></html>`;

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

describe('roster mint withdrawal evidence', () => {
  it('records only a person whose own profile was read and minted nothing', async () => {
    const entries: FacultyEntry[] = [
      {
        name: 'Ada Alpha',
        title: 'Professor of Synthetic Studies',
        labUrl: 'https://alpha-lab.example.org',
      },
      {
        name: 'Bea Beta',
        title: 'Professor of Synthetic Studies',
        profileUrl: 'https://synthetic.yale.edu/profile/bea-beta/',
      },
      {
        name: 'Cy Gamma',
        title: 'Professor of Synthetic Studies',
        profileUrl: 'https://synthetic.yale.edu/profile/cy-gamma/',
      },
    ];
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url.includes('bea-beta')) return profileHtml('Bea Beta');
      if (url.includes('cy-gamma')) throw new Error('503');
      return '<html><body></body></html>';
    });
    const scraper = new DepartmentRosterScraper(
      [{ ...DEPT, extractor: () => entries }],
      null,
      htmlFetcher,
    );
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const snapshot = emitted.find((o) => o.entityType === 'departmentRosterHealth')?.value as any;
    expect(snapshot.mintWithdrawalRecorded).toBe(true);
    expect(snapshot.withdrawnEntityKeys).toEqual([rosterResearchEntitySlug(entries[1], DEPT)]);
    expect(snapshot.discoveredEntityKeys).toEqual([rosterResearchEntitySlug(entries[0], DEPT)]);
    expect(snapshot.profilesRead).toBe(1);
  });

  it('withdraws nothing for a title refusal, an unread profile or a profile-only lane', () => {
    const entry: FacultyEntry = { name: 'Bea Beta', profileReadOutcome: 'read' };
    const empty = { observations: [], refusedByTitle: false };
    expect(rosterMintWithdrawnEntityKey(entry, DEPT, empty)).toBe(
      rosterResearchEntitySlug(entry, DEPT),
    );
    expect(rosterMintWithdrawnEntityKey(entry, DEPT, { ...empty, refusedByTitle: true })).toBe('');
    expect(
      rosterMintWithdrawnEntityKey({ ...entry, profileReadOutcome: 'unread' }, DEPT, empty),
    ).toBe('');
    expect(
      rosterMintWithdrawnEntityKey({ ...entry, profileReadOutcome: 'refused' }, DEPT, empty),
    ).toBe('');
    expect(rosterMintWithdrawnEntityKey(entry, { ...DEPT, officialProfileOnly: true }, empty)).toBe(
      '',
    );
    expect(
      rosterMintWithdrawnEntityKey(entry, { ...DEPT, crossListedProgramme: true }, empty),
    ).toBe('');
  });
});
