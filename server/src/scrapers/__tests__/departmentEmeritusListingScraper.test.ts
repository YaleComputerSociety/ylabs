import { describe, expect, it, vi } from 'vitest';
import {
  DEPARTMENT_LISTS_LEAD_AS_EMERITUS,
  leadTitlesAreAllEmeritus,
} from '../../services/emeritusLeadWayIn';
import {
  DepartmentEmeritusListingScraper,
  EMERITUS_LISTED_LEADS_FIELD,
  emeritusListingPeople,
} from '../sources/departmentEmeritusListingScraper';
import type { ObservationInput, ScraperContext } from '../types';

const PAGE = { department: 'Fixture Studies', url: 'https://fixture.example.edu/people/emeriti' };

const page = (names: string[]) =>
  `<main>${names
    .map(
      (name) =>
        `<article><h3 class="directory-listing-card__heading"><a href="/profile/${name
          .toLowerCase()
          .replace(/\s+/g, '-')}">${name}</a></h3></article>`,
    )
    .join('')}</main>`;

function context(emitted: ObservationInput[], only?: string[]): ScraperContext {
  return {
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'department-emeritus-listings',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, only },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

describe('department emeritus listings (#5835)', () => {
  it('reads each listed person once with the profile the card links', () => {
    expect(
      emeritusListingPeople(
        page(['Avery Synthetic', 'Avery Synthetic', 'Blair Invented']),
        PAGE.url,
      ),
    ).toEqual([
      {
        name: 'Avery Synthetic',
        profileUrl: 'https://fixture.example.edu/profile/avery-synthetic',
      },
      { name: 'Blair Invented', profileUrl: 'https://fixture.example.edu/profile/blair-invented' },
    ]);
  });

  it('counts a department-listed lead as emeritus, and every lead must be', () => {
    expect(leadTitlesAreAllEmeritus([DEPARTMENT_LISTS_LEAD_AS_EMERITUS])).toBe(true);
    expect(
      leadTitlesAreAllEmeritus([DEPARTMENT_LISTS_LEAD_AS_EMERITUS, 'Professor of Fixtures']),
    ).toBe(false);
    expect(leadTitlesAreAllEmeritus(['Professor of Fixtures'])).toBe(false);
  });

  it('records resolved leads on the rows they lead and nothing for a person it cannot place', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new DepartmentEmeritusListingScraper({
      pages: [PAGE],
      fetchText: async () => page(['Avery Synthetic', 'Blair Invented']),
      resolveLead: async (person) =>
        person.name === 'Avery Synthetic' ? { researcherId: 'r-avery', slug: 'avery-row' } : null,
      storedListingFinder: async () => new Map(),
    });
    await scraper.run(context(emitted));
    expect(emitted).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'avery-row',
        field: EMERITUS_LISTED_LEADS_FIELD,
        value: ['r-avery'],
      },
    ]);
  });

  it('withdraws a stale listing only after a complete read', async () => {
    const stored = async () => new Map([['former-row', ['r-former']]]);
    const complete: ObservationInput[] = [];
    await new DepartmentEmeritusListingScraper({
      pages: [PAGE],
      fetchText: async () => page([]),
      resolveLead: async () => null,
      storedListingFinder: stored,
    }).run(context(complete));
    expect(complete).toEqual([
      expect.objectContaining({
        entityKey: 'former-row',
        value: null,
        assertsNoValueFor: [EMERITUS_LISTED_LEADS_FIELD],
      }),
    ]);

    const partial: ObservationInput[] = [];
    await new DepartmentEmeritusListingScraper({
      pages: [PAGE],
      fetchText: async () => null,
      resolveLead: async () => null,
      storedListingFinder: stored,
    }).run(context(partial));
    expect(partial).toEqual([]);
  });
});
