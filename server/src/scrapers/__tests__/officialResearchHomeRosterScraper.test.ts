import { describe, expect, it, vi } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  mapOfficialRosterRole,
  officialRosterObservations,
  OfficialResearchHomeRosterScraper,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';

const config: OfficialRosterConfig = {
  researchEntityKey: 'ysm-fixture',
  url: 'https://medicine.yale.edu/lab/fixture/members/',
  currentSectionLabels: ['Current Members'],
};

const card = (name: string, title: string, href: string) => `
  <article class="profile-grid-item" aria-label="${name}'s Profile">
    <a class="profile-grid-item__link-details" href="${href}">
      <span class="profile-grid-item__name">${name}</span>
    </a>
    <p class="profile-grid-item__title">${title}</p>
  </article>`;

const page = (current: string, former = '') => `
  <html><head><meta property="publish-date" content="7/22/2025" /></head><body>
    <section class="organization-member-listing" aria-label="Current Members">
      <h2>Current Members</h2>${current}
    </section>
    <section class="organization-member-listing" aria-label="Former Members">
      <h2>Former Members</h2>${former}
    </section>
  </body></html>`;

describe('official research-home roster acquisition', () => {
  it('keeps current and historical sections separate and maps honest roles', () => {
    const roster = extractOfficialResearchHomeRoster(
      page(
        card('Current Scholar', 'Graduate Student', '/lab/fixture/profile/current-scholar/'),
        card('Former Scholar', 'Graduate Student, 2018-2022', '/lab/fixture/profile/former-scholar/'),
      ),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );

    expect(roster.state).toBe('current');
    expect(roster.members).toHaveLength(1);
    expect(roster.members[0]).toMatchObject({ name: 'Current Scholar', role: 'grad-student' });
    expect(roster.members.map((member) => member.name)).not.toContain('Former Scholar');
  });

  it('maps supported roles and refuses ambiguous titles', () => {
    expect(mapOfficialRosterRole('Postdoctoral Associate', 'Current Members')).toBe('postdoc');
    expect(mapOfficialRosterRole('Research Assistant 2', 'Current Members')).toBe('staff');
    expect(mapOfficialRosterRole('Undergraduate Student', 'Current Members')).toBe('undergrad');
    expect(mapOfficialRosterRole('Interesting Person', 'Current Members')).toBeNull();
  });

  it('deduplicates exact source identities and withholds identity collisions', () => {
    const duplicate = card('Same Scholar', 'Graduate Student', '/lab/fixture/profile/same/');
    const deduped = extractOfficialResearchHomeRoster(
      page(`${duplicate}${duplicate}`),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );
    expect(deduped.members).toHaveLength(1);
    expect(deduped.duplicateCount).toBe(1);

    const collision = extractOfficialResearchHomeRoster(
      page(
        `${card('First Person', 'Graduate Student', '/lab/fixture/profile/collision/')}${card(
          'Different Person',
          'Graduate Student',
          '/lab/fixture/profile/collision/',
        )}`,
      ),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );
    expect(collision.state).toBe('withheld');
    expect(collision.members).toEqual([]);
    expect(collision.withheldCount).toBe(2);
  });

  it('does not mark a partial snapshot complete for archival reconciliation', () => {
    const partial = extractOfficialResearchHomeRoster(
      page(
        `${card('Verified Scholar', 'Graduate Student', '/lab/fixture/profile/verified/')}${card(
          'Ambiguous Scholar',
          'Interesting Person',
          '/lab/fixture/profile/ambiguous/',
        )}`,
      ),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );

    expect(partial).toMatchObject({
      state: 'partial',
      complete: false,
      withheldCount: 1,
    });
    expect(partial.members).toHaveLength(1);
  });

  it('redacts direct contact text and excludes it from emitted observations', () => {
    const roster = extractOfficialResearchHomeRoster(
      page(
        card(
          'Safe Scholar',
          'Research Assistant fixture.scholar@yale.edu 203-432-1234',
          '/lab/fixture/profile/safe-scholar/',
        ),
      ),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );
    const serialized = JSON.stringify(officialRosterObservations(config, roster));
    expect(serialized).not.toContain('fixture.scholar@yale.edu');
    expect(serialized).not.toContain('203-432-1234');
    expect(serialized).toContain('[email redacted]');
  });

  it('withholds sources whose publish evidence is missing or stale', () => {
    const stale = extractOfficialResearchHomeRoster(
      page(card('Stale Scholar', 'Graduate Student', '/lab/fixture/profile/stale/')).replace(
        '7/22/2025',
        '1/1/2020',
      ),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );
    expect(stale).toMatchObject({ state: 'stale', complete: false, members: [] });
  });

  it('records optional source failure without emitting or archiving a roster snapshot', async () => {
    const emit = vi.fn(async () => undefined);
    const scraper = new OfficialResearchHomeRosterScraper([config], vi.fn().mockRejectedValue(new Error('offline')));
    const result = await scraper.run({
      scrapeRunId: 'run',
      sourceId: 'source',
      sourceName: 'official-research-home-roster',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit,
      log: vi.fn(),
    });

    expect(result.notes).toContain('failed=1');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'rosterEnrichment',
        value: expect.objectContaining({ state: 'failed', complete: false, memberKeys: [] }),
      }),
    );
  });
});
