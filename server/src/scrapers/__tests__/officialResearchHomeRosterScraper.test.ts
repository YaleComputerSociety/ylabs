import { describe, expect, it, vi } from 'vitest';
import {
  extractAlumniPageUndergraduates,
  extractOfficialResearchHomeRoster,
  listedEntryIsFromAnotherSchool,
  listedEntryRole,
  looksLikeListedPersonName,
  mapOfficialRosterRole,
  officialRosterSectionLabels,
  officialRosterObservations,
  OfficialResearchHomeRosterScraper,
  withAlumniUndergraduates,
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
        card(
          'Former Scholar',
          'Graduate Student, 2018-2022',
          '/lab/fixture/profile/former-scholar/',
        ),
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

  const runContext = (emit: (obs: unknown) => Promise<void>) => ({
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'official-research-home-roster',
    sourceWeight: 0.95,
    options: { dryRun: true, useCache: false, release: false },
    emit,
    log: vi.fn(),
  });

  it('records optional source failure without emitting or archiving a roster snapshot', async () => {
    const emit = vi.fn(async () => undefined);
    const secondConfig: OfficialRosterConfig = {
      ...config,
      researchEntityKey: 'ysm-fixture-two',
      url: 'https://medicine.yale.edu/lab/fixture-two/members/',
    };
    const fetchPage = vi.fn(async (url: string) => {
      if (url === config.url) throw new Error('offline');
      return page(card('Current Scholar', 'Graduate Student', '/lab/fixture/profile/current/'));
    });
    const scraper = new OfficialResearchHomeRosterScraper([config, secondConfig], fetchPage);
    const result = await scraper.run(runContext(emit));

    expect(result.notes).toContain('failed=1');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'rosterEnrichment',
        value: expect.objectContaining({ state: 'failed', complete: false, memberKeys: [] }),
      }),
    );
  });

  it('fails the run when every attempted roster fetch failed, so it is not recorded a success', async () => {
    const emit = vi.fn(async () => undefined);
    const scraper = new OfficialResearchHomeRosterScraper(
      [config],
      vi.fn().mockRejectedValue(new Error('offline')),
    );

    await expect(scraper.run(runContext(emit))).rejects.toThrow(
      /every attempted official roster fetch failed/i,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.objectContaining({ state: 'failed', complete: false }),
      }),
    );
  });
});

const yaleSitesConfig: OfficialRosterConfig = {
  researchEntityKey: 'dept-fixture-lab',
  url: 'https://fixturelab.yale.edu/people',
  template: 'yalesites-directory',
  currentSectionLabels: ['Lab Members'],
  pastSectionLabels: ['Lab Alumni'],
};

const directoryCard = (name: string, title: string, href = '') => `
  <li class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        ${href ? `<a class="directory-listing-card__heading-link" href="${href}">${name}</a>` : name}
      </h3>
      <div class="directory-listing-card__subheading"><div>${title}</div></div>
    </div>
  </li>`;

const directoryCollection = (cards: string) =>
  `<section aria-label="Profiles collection"><ul class="card-collection__cards">${cards}</ul></section>`;

const alumniTable = (rows: Array<[string, string, string, string]>) => `
  <div class="text"><table>
    <thead><tr>
      <th>Former Lab Member</th><th>Position in Lab</th><th>Departure Date</th><th>Current Position</th>
    </tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;

const yaleSitesPage = ({
  members = '',
  alumni = '',
  membersHeading = 'Lab Members',
}: {
  members?: string;
  alumni?: string;
  membersHeading?: string;
}) => `
  <html><head><meta name="Generator" content="Drupal 10" /></head><body><main>
    <h1>People</h1>
    <h3>Primary Investigator</h3>
    ${directoryCollection(directoryCard('Robin Elder', 'Professor', '/profile/lead-fixture'))}
    <h3>${membersHeading}</h3>
    ${directoryCollection(members)}
    <h3>Lab Alumni</h3>
    ${alumni}
  </main></body></html>`;

describe('YaleSites directory rosters', () => {
  const observedAt = new Date('2026-10-14T00:00:00Z');

  it('reads current members from the configured section without a publish date', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        members:
          directoryCard('Jordan Alder', 'Ph.D. Candidate', '/profile/grad-fixture') +
          directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture'),
      }),
      yaleSitesConfig,
      observedAt,
    );

    expect(roster.state).toBe('current');
    expect(roster.sourcePublishedAt).toBeUndefined();
    expect(
      roster.members.map(({ name, role, profileUrl }) => ({ name, role, profileUrl })),
    ).toEqual([
      {
        name: 'Jordan Alder',
        role: 'grad-student',
        profileUrl: 'https://fixturelab.yale.edu/profile/grad-fixture',
      },
      {
        name: 'Avery Quill',
        role: 'undergrad',
        profileUrl: 'https://fixturelab.yale.edu/profile/undergrad-fixture',
      },
    ]);
    expect(roster.members.map((member) => member.name)).not.toContain('Robin Elder');
  });

  it('withholds a card with no mappable role or no same-host profile link', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        members:
          directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture') +
          directoryCard('Mascot Fixture', 'Lab Mascot', '/profile/mascot-fixture') +
          directoryCard('Casey Offsite', 'Undergraduate', 'https://elsewhere.example/profile/x'),
      }),
      yaleSitesConfig,
      observedAt,
    );

    expect(roster.state).toBe('partial');
    expect(roster.withheldCount).toBe(2);
    expect(roster.members.map((member) => member.name)).toEqual(['Avery Quill']);
  });

  it('withholds the whole roster when the configured current section is missing', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        membersHeading: 'Our Team',
        members: directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture'),
      }),
      yaleSitesConfig,
      observedAt,
    );

    expect(roster.state).toBe('withheld');
    expect(roster.members).toEqual([]);
    expect(roster.undergraduates).toEqual([]);
  });

  it('lists current undergraduates with their profile link and leaves other roles to the cards', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        members:
          directoryCard('Jordan Alder', 'Ph.D. Student', '/profile/grad-fixture') +
          directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture'),
      }),
      yaleSitesConfig,
      observedAt,
    );

    expect(roster.undergraduates).toEqual([
      {
        name: 'Avery Quill',
        status: 'current',
        profileUrl: 'https://fixturelab.yale.edu/profile/undergrad-fixture',
      },
    ]);
  });

  it('lists past undergraduates from the labelled alumni table and nobody else from it', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        members: directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture'),
        alumni: alumniTable([
          ['Rowan Thistle', 'Undergraduate Researcher', '2024 (Yale)', 'Medical Student'],
          ['Morgan Fennel', 'Doctoral Student', '2023 (Yale)', 'Assistant Professor, Elsewhere'],
          ['Quinn Larkspur', 'Master’s Student', '2016', 'Engineer'],
        ]),
      }),
      yaleSitesConfig,
      observedAt,
    );

    expect(roster.undergraduates.filter((member) => member.status === 'past')).toEqual([
      { name: 'Rowan Thistle', status: 'past', endYear: 2024 },
    ]);
    expect(JSON.stringify(roster.undergraduates)).not.toContain('Medical Student');
  });

  it('carries listed undergraduates on the roster snapshot observation', () => {
    const roster = extractOfficialResearchHomeRoster(
      yaleSitesPage({
        members: directoryCard('Avery Quill', 'Undergraduate', '/profile/undergrad-fixture'),
        alumni: alumniTable([['Rowan Thistle', 'Undergraduate', '2024', 'Elsewhere']]),
      }),
      yaleSitesConfig,
      observedAt,
    );
    const snapshot = officialRosterObservations(yaleSitesConfig, roster).find(
      (observation) => observation.field === 'rosterEnrichment',
    );

    expect(snapshot?.value).toMatchObject({
      state: 'current',
      undergraduates: [
        { name: 'Avery Quill', status: 'current' },
        { name: 'Rowan Thistle', status: 'past', endYear: 2024 },
      ],
      undergraduateWithheldCount: 0,
    });
  });
});

const headingListConfig: OfficialRosterConfig = {
  researchEntityKey: 'dept-fixture-group',
  url: 'https://fixturegroup.yale.edu/research-team',
  template: 'heading-list',
  currentSectionLabels: ['Undergraduate Researchers'],
  pastSectionLabels: ['Undergraduate Alumni'],
};

const headingListPage = `
  <html><body>
    <nav><ul><li>Home</li><li>Research Team</li></ul></nav>
    <main>
      <h2>Graduate Student Researchers</h2>
      <div><strong>Jordan Alder</strong><br />Ph.D. Environmental Engineering (2020-present)</div>
      <h2>Undergraduate Researchers</h2>
      <ul>
        <li>Ellis Juniper (2022-current)</li>
        <li>Harper Wren (2024-present)</li>
      </ul>
      <h2>Undergraduate Alumni</h2>
      <ul>
        <li>Indigo Sorrel (2021–2024)</li>
        <li>Parker Moss (2022)</li>
        <li>2019 Summer Cohort</li>
      </ul>
      <h2>Contact</h2>
      <ul><li>Room 100, Fixture Hall</li></ul>
    </main>
  </body></html>`;

describe('heading-list rosters', () => {
  const observedAt = new Date('2026-10-14T00:00:00Z');

  it('reads undergraduates listed by name and years under labelled headings', () => {
    const roster = extractOfficialResearchHomeRoster(
      headingListPage,
      headingListConfig,
      observedAt,
    );

    expect(roster.state).toBe('current');
    expect(roster.members).toEqual([]);
    expect(roster.undergraduates).toEqual([
      { name: 'Ellis Juniper', status: 'current', startYear: 2022 },
      { name: 'Harper Wren', status: 'current', startYear: 2024 },
      { name: 'Indigo Sorrel', status: 'past', startYear: 2021, endYear: 2024 },
      { name: 'Parker Moss', status: 'past', endYear: 2022 },
    ]);
    expect(roster.undergraduateWithheldCount).toBe(1);
  });

  it('reports only the headings that list people as roster sections for the audit', () => {
    expect(officialRosterSectionLabels(headingListPage, 'heading-list')).toEqual([
      'Graduate Student Researchers',
      'Undergraduate Researchers',
      'Undergraduate Alumni',
      'Contact',
    ]);
  });

  it('withholds the roster when the current undergraduate heading is missing', () => {
    const roster = extractOfficialResearchHomeRoster(
      headingListPage.replace('Undergraduate Researchers', 'Students'),
      headingListConfig,
      observedAt,
    );

    expect(roster.state).toBe('withheld');
    expect(roster.undergraduates).toEqual([]);
  });
});

describe('heading-list document-order walker', () => {
  const observedAt = new Date('2026-10-14T00:00:00Z');
  const config: OfficialRosterConfig = {
    researchEntityKey: 'dept-fixture-walker',
    url: 'https://walkerlab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels: ['Undergraduate Students'],
  };

  it('reads name headings nested under a wrapped section heading, with profile links', () => {
    const html = `<html><body><main>
      <div class="wrap"><h2>Undergraduate Students</h2></div>
      <div class="cards">
        <div class="card"><h3><a href="/people/avery-quill">Avery Quill</a></h3><p>Class of 2027</p></div>
        <div class="card"><h3>Harper Wren</h3><p>Chemistry major</p></div>
        <div class="card"><h3>Research Interests</h3><p>Not a person</p></div>
      </div>
      <h2>Graduate Students</h2>
      <div class="card"><h3>Jordan Alder</h3></div>
    </main></body></html>`;
    const roster = extractOfficialResearchHomeRoster(html, config, observedAt);

    expect(roster.undergraduates.map((member) => member.name)).toEqual([
      'Avery Quill',
      'Harper Wren',
    ]);
  });

  it('reads a bold name leading a paragraph and drops page chrome after a name', () => {
    const html = `<html><body><main>
      <h3>Undergraduate Students</h3>
      <p><strong>Ellis Juniper</strong><br />B.S. Candidate (2024-present)</p>
      <ul><li>Parker MossView Full Profile</li><li>Copy Link</li></ul>
      <p>Our undergraduates work on field projects every summer.</p>
    </main></body></html>`;
    const roster = extractOfficialResearchHomeRoster(html, config, observedAt);

    expect(roster.undergraduates).toEqual([
      { name: 'Ellis Juniper', status: 'current', startYear: 2024 },
      { name: 'Parker Moss', status: 'current' },
    ]);
  });

  it('shows a name written in capitals in normal case', () => {
    const html = `<html><body><main><h3>Undergraduate Students</h3>
      <ul><li>AVERY QUILL</li><li>HARPER O'WREN-LARK</li></ul></main></body></html>`;
    expect(
      extractOfficialResearchHomeRoster(html, config, observedAt).undergraduates.map((m) => m.name),
    ).toEqual(['Avery Quill', "Harper O'Wren-Lark"]);
  });

  it('ignores navigation and footer lists', () => {
    const html = `<html><body>
      <nav><h3>Undergraduate Students</h3><ul><li>Avery Quill</li></ul></nav>
      <main><h3>Undergraduate Students</h3><ul><li>Harper Wren</li></ul></main>
      <footer><ul><li>Rowan Thistle</li></ul></footer>
    </body></html>`;
    const roster = extractOfficialResearchHomeRoster(html, config, observedAt);

    expect(roster.undergraduates.map((member) => member.name)).toEqual(['Harper Wren']);
  });

  it('refuses role labels, section words and sentence fragments as names', () => {
    for (const value of [
      'Undergraduate Students',
      'Research Collaborators',
      'Postgraduate Associate',
      'Copy Link',
      'Our undergraduates work on field projects',
      'Lab Alumni',
      'jordan alder',
      'Protein Folding in Organisms',
      'BS Neuroscience',
      'Mathematics, & Computer Science',
      'Psychology Major',
      'Jordan Alder, PhD',
      'University of Oregon',
      'Postgrad Plan',
      'Fun Fact',
    ]) {
      expect(looksLikeListedPersonName(value)).toBe(false);
    }
    expect(looksLikeListedPersonName('Ana María de la Cruz')).toBe(true);
    expect(looksLikeListedPersonName('Ellis Juniper')).toBe(true);
  });
});

describe('telling past undergraduates from current ones', () => {
  const observedAt = new Date('2026-10-14T00:00:00Z');
  const config: OfficialRosterConfig = {
    researchEntityKey: 'dept-fixture-split',
    url: 'https://splitlab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels: ['Undergraduate Students'],
  };
  const statuses = (html: string) =>
    extractOfficialResearchHomeRoster(html, config, observedAt).undergraduates.map(
      ({ name, status }) => `${name}:${status}`,
    );

  it('reads a same-named section nested under an alumni heading as past', () => {
    expect(
      statuses(`<html><body><main>
        <h2>Current Members</h2>
        <h3>Undergraduate Students</h3><ul><li>Avery Quill</li></ul>
        <h2>Alumni</h2>
        <h3>Undergraduate Students</h3><ul><li>Rowan Thistle (Elsewhere University)</li></ul>
      </main></body></html>`),
    ).toEqual(['Avery Quill:current', 'Rowan Thistle:past']);
  });

  it('reads entries after an alumni toggle as past', () => {
    expect(
      statuses(`<html><body><main>
        <h3>Undergraduate Students</h3>
        <ul><li>Avery Quill</li></ul>
        <details><summary>View Alumni</summary><ul><li>Rowan Thistle</li></ul></details>
      </main></body></html>`),
    ).toEqual(['Avery Quill:current', 'Rowan Thistle:past']);
  });

  it('reads a future class year as current and a completed one as past', () => {
    expect(
      statuses(`<html><body><main>
        <h3>Undergraduate Students</h3>
        <ul><li>Avery Quill (2028)</li><li>Harper Wren (2026)</li></ul>
      </main></body></html>`),
    ).toEqual(['Avery Quill:current', 'Harper Wren:past']);
  });

  it('lists a current undergraduate once even when an alumni table repeats them', () => {
    expect(
      statuses(`<html><body><main>
        <h3>Undergraduate Students</h3><ul><li>Avery Quill</li></ul>
        <h2>Alumni</h2>
        <h3>Undergraduate Students</h3>
        <ul><li>Avery Quill (2027)</li><li>Rowan Thistle (2022)</li></ul>
      </main></body></html>`),
    ).toEqual(['Avery Quill:current', 'Rowan Thistle:past']);
  });

  it('skips an indented continuation line of the previous entry', () => {
    expect(
      statuses(`<html><body><main>
        <h3>Undergraduate Students</h3>
        <p>Avery Quill</p>
        <p>&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Universidad Catolica Lima</p>
      </main></body></html>`),
    ).toEqual(['Avery Quill:current']);
  });

  it('reads an end year, or a start year more than five years back, as past', () => {
    expect(
      statuses(`<html><body><main>
        <h3>Undergraduate Students</h3>
        <ul>
          <li>Avery Quill (2024-present)</li>
          <li>Harper Wren (2018-present)</li>
          <li>Rowan Thistle (2021-2023)</li>
        </ul>
        <h4>Ellis Juniper</h4>
        <p>B.S., 2019</p>
        <table><tbody><tr><td>Parker Moss</td><td>B.S., 2013</td></tr></tbody></table>
      </main></body></html>`),
    ).toEqual(
      expect.arrayContaining([
        'Avery Quill:current',
        'Harper Wren:past',
        'Rowan Thistle:past',
        'Parker Moss:past',
        'Ellis Juniper:past',
      ]),
    );
  });
});

describe('reading each person from their own line', () => {
  const observedAt = new Date('2026-10-16T12:00:00Z');
  const config: OfficialRosterConfig = {
    researchEntityKey: 'dept-fixture-own',
    url: 'https://ownlab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels: ['Current Members'],
    pastSectionLabels: ['Former Members'],
  };
  const listed = (html: string) =>
    extractOfficialResearchHomeRoster(html, config, observedAt).undergraduates.map(
      ({ name, status }) => `${name}:${status}`,
    );

  it('lets a person line outrank the section heading', () => {
    expect(
      listedEntryRole({ title: '', years: "(Master's Student)" }, 'Undergraduate Students'),
    ).toBe('grad-student');
    expect(listedEntryRole({ title: '', years: "Yale College '27" }, 'Current Members')).toBe(
      'undergrad',
    );
    expect(listedEntryRole({ title: '', years: 'B.S. 2019, Ph.D. 2024' }, 'Alumni')).toBeNull();
  });

  it('reads undergraduates from cards that state only a Yale College class year', () => {
    expect(
      listed(`<html><body><main><h3>Current Members</h3><ul>
        <li><h2>Avery Quill</h2><p>Timothy Dwight College</p><p>Yale College ‘28</p></li>
        <li><h2>Jordan Alder</h2><p>PhD Candidate</p></li>
      </ul></main></body></html>`),
    ).toEqual(['Avery Quill:current']);
  });

  it('splits a paragraph of names on line breaks and keeps short descriptor lines', () => {
    expect(
      listed(`<html><body><main><h3>Current Members</h3><ul><li>Jordan Alder (PhD Candidate)</li></ul>
        <h3>Former Members</h3>
        <p>Avery Quill, Yale College '22<br>Harper Wren<br>Class of 2023<br>Rowan Thistle (B.S. 2021)</p>
      </main></body></html>`),
    ).toEqual(['Avery Quill:past', 'Harper Wren:past', 'Rowan Thistle:past']);
  });

  it('leaves out undergraduates the page ties to another school', () => {
    for (const years of [
      'Visiting undergraduate from Elsewhere University',
      'Undergraduate Student at Fordham University',
      'B.S. Fairfield University (2024)',
      'Summer intern from Valley Christian High School',
    ]) {
      expect(listedEntryIsFromAnotherSchool({ title: '', years })).toBe(true);
    }
    for (const years of [
      '(Yale)',
      "Yale College '24",
      '(Princeton University)',
      '2021-2024, now at MIT',
    ]) {
      expect(listedEntryIsFromAnotherSchool({ title: '', years })).toBe(false);
    }
  });
});

describe('round-three roster rules', () => {
  const observedAt = new Date('2026-10-16T12:00:00Z');
  const config: OfficialRosterConfig = {
    researchEntityKey: 'dept-fixture-three',
    url: 'https://threelab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels: ['Undergraduate Students'],
    pastSectionLabels: ['Alumni'],
  };
  const listed = (html: string) =>
    extractOfficialResearchHomeRoster(html, config, observedAt).undergraduates.map(
      ({ name, status }) => `${name}:${status}`,
    );

  it('reads a bracket as the home school only where most brackets say Yale', () => {
    expect(
      listed(`<html><body><main><h3>Undergraduate Students</h3><ul><li>Jordan Alder</li></ul>
        <h2>Alumni</h2><h3>Undergraduate Students</h3><ul>
          <li>Avery Quill (Yale)</li><li>Harper Wren (Yale)</li><li>Rowan Thistle (Elsewhere University)</li>
        </ul></main></body></html>`),
    ).toEqual(['Jordan Alder:current', 'Avery Quill:past', 'Harper Wren:past']);
    expect(
      listed(`<html><body><main><h3>Undergraduate Students</h3><ul><li>Jordan Alder</li></ul>
        <h2>Alumni</h2><h3>Undergraduate Students</h3><ul>
          <li>Avery Quill (Elsewhere University)</li><li>Harper Wren (Yale University)</li>
          <li>Rowan Thistle (Another Institute)</li>
        </ul></main></body></html>`),
    ).toHaveLength(4);
  });

  it('leaves out a section headed by another university', () => {
    expect(
      listed(`<html><body><main><h3>Undergraduate Students</h3><ul><li>Jordan Alder</li></ul>
        <h2>Alumni</h2><h3>Undergraduate Students at Elsewhere State University</h3>
        <ul><li>Avery Quill</li></ul></main></body></html>`),
    ).toEqual(['Jordan Alder:current']);
  });

  it('ignores planned degrees and keeps a senior-thesis student who stayed on as postgraduate', () => {
    expect(
      listedEntryRole(
        { title: '', years: 'BS Chemistry Yale 2029 Postgrad Plan: MD, PhD' },
        'Undergraduate Students',
      ),
    ).toBe('undergrad');
    expect(
      listedEntryRole(
        { title: '', years: '(Senior Thesis 2020; Postgraduate Researcher 2020-2021)' },
        'Alumni',
      ),
    ).toBe('undergrad');
    expect(listedEntryRole({ title: '', years: '(Postbac)' }, 'Undergraduate Students')).toBeNull();
    expect(
      listedEntryRole({ title: '', years: '(M.S. 2025)' }, 'Undergraduate Students'),
    ).toBeNull();
  });

  it('reads names from a layout table without taking the next column as their own line', () => {
    expect(
      listed(`<html><body><main><h3>Undergraduate Students</h3><ul><li>Jordan Alder</li></ul>
        <h3>Alumni</h3><table><tbody><tr>
          <td><p>Person</p><p>Avery Quill (Yale College ‘24)</p><p>Harper Wren (Yale College ‘23)</p></td>
          <td><p>Current position</p><p>PhD student, Fixture lab</p><p>Analyst</p></td>
        </tr></tbody></table></main></body></html>`),
    ).toEqual(['Jordan Alder:current', 'Avery Quill:past', 'Harper Wren:past']);
  });
});

describe('owner name judgements', () => {
  it('leaves out withheld names and lists past names as past, whatever the page says', () => {
    const html = `<html><body><main><h3>Undergraduate Students</h3><ul>
      <li>Avery Quill</li><li>Harper Wren</li><li>Rowan Thistle Rowan Thistle</li>
    </ul></main></body></html>`;
    const roster = extractOfficialResearchHomeRoster(
      html,
      {
        researchEntityKey: 'dept-fixture-judged',
        url: 'https://judgedlab.yale.edu/people',
        template: 'heading-list',
        currentSectionLabels: ['Undergraduate Students'],
        withheldNames: ['avery quill'],
        pastNames: ['Harper Wren'],
      },
      new Date('2026-10-16T12:00:00Z'),
    );
    expect(roster.undergraduates.map(({ name, status }) => `${name}:${status}`)).toEqual([
      'Harper Wren:past',
      'Rowan Thistle:current',
    ]);
    expect(roster.undergraduateWithheldCount).toBe(1);
  });
});

describe('profile-grid pages with alumni outside the member grid', () => {
  it('reads former undergraduates listed in the page text below the grid', () => {
    const html = page(
      card('Avery Quill', 'Undergraduate Student', '/lab/fixture/profile/avery-quill/'),
    ).replace(
      '</body>',
      `<div class="generic-content"><h2>Former Members</h2>
        <ul><li>Rowan Thistle (Yale College 2023)</li></ul></div></body>`,
    );
    const roster = extractOfficialResearchHomeRoster(
      html,
      { ...config, pastSectionLabels: ['Former Members'] },
      new Date('2026-07-14T00:00:00Z'),
    );
    expect(roster.undergraduates.map(({ name, status }) => `${name}:${status}`)).toEqual([
      'Avery Quill:current',
      'Rowan Thistle:past',
    ]);
  });
});

describe('section-label currency on a profile-grid page', () => {
  it('reads a profile-grid page with an old publish date when the config opts into section-label currency', () => {
    const html = page(
      card('Avery Quill', 'Undergraduate Student', '/lab/fixture/profile/avery-quill/'),
    ).replace('7/22/2025', '9/17/2024');
    const observedAt = new Date('2026-10-14T00:00:00Z');

    expect(extractOfficialResearchHomeRoster(html, config, observedAt).state).toBe('stale');
    expect(
      extractOfficialResearchHomeRoster(html, { ...config, currency: 'section-label' }, observedAt)
        .undergraduates,
    ).toEqual([
      {
        name: 'Avery Quill',
        status: 'current',
        profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/avery-quill/',
      },
    ]);
  });
});

describe('profile-grid past sections', () => {
  it('lists a former undergraduate from a configured section with the range end as the end year', () => {
    const roster = extractOfficialResearchHomeRoster(
      page(
        card('Current Scholar', 'Graduate Student', '/lab/fixture/profile/current-scholar/'),
        card(
          'Taylor Birch',
          'Undergraduate Student, 2018-2022',
          '/lab/fixture/profile/former-scholar/',
        ),
      ),
      { ...config, pastSectionLabels: ['Former Members'] },
      new Date('2026-07-14T00:00:00Z'),
    );

    expect(roster.undergraduates).toEqual([
      {
        name: 'Taylor Birch',
        status: 'past',
        startYear: 2018,
        endYear: 2022,
        profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/former-scholar/',
      },
    ]);
  });
  it('still refuses a profile-grid page without a recent publish date', () => {
    const roster = extractOfficialResearchHomeRoster(
      page(
        card('Current Scholar', 'Graduate Student', '/lab/fixture/profile/current-scholar/'),
      ).replace(/<meta[^>]*publish-date[^>]*>/, ''),
      config,
      new Date('2026-07-14T00:00:00Z'),
    );

    expect(roster.state).toBe('stale');
  });
});

describe('a separate alumni page', () => {
  const observedAt = new Date('2026-10-16T12:00:00Z');
  const config: OfficialRosterConfig = {
    researchEntityKey: 'dept-fixture-alumni',
    url: 'https://alumnilab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels: ['Undergraduate Students'],
    alumniPageUrl: 'https://alumnilab.yale.edu/alumni',
  };
  const peoplePage = `<html><body><main><h3>Undergraduate Students</h3>
    <ul><li>Avery Quill (2025-present)</li></ul></main></body></html>`;
  const alumniPage = `<html><body><main>
    <h3>Graduate Students</h3><ul><li>Jordan Alder (PhD 2021)</li></ul>
    <h3>Undergraduates</h3><ul>
      <li>Avery Quill (2025)</li><li>Harper Wren (2019-2021)</li>
      <li>Rowan Thistle (Visiting undergraduate from Elsewhere University)</li>
    </ul></main></body></html>`;

  it('lists every undergraduate on the alumni page as past, under the same rules', () => {
    expect(extractAlumniPageUndergraduates(alumniPage, config, observedAt).undergraduates).toEqual([
      { name: 'Avery Quill', status: 'past', endYear: 2025 },
      { name: 'Harper Wren', status: 'past', startYear: 2019, endYear: 2021 },
    ]);
  });

  it('keeps a current member current when the alumni page also lists them', () => {
    const merged = withAlumniUndergraduates(
      extractOfficialResearchHomeRoster(peoplePage, config, observedAt),
      extractAlumniPageUndergraduates(alumniPage, config, observedAt).undergraduates,
    );
    expect(merged.undergraduates.map(({ name, status }) => `${name}:${status}`)).toEqual([
      'Avery Quill:current',
      'Harper Wren:past',
    ]);
  });

  it('adds nothing to a roster whose own page could not be read', () => {
    const withheld = extractOfficialResearchHomeRoster(
      peoplePage.replace('Undergraduate Students', 'Our Team'),
      config,
      observedAt,
    );
    expect(
      withAlumniUndergraduates(
        withheld,
        extractAlumniPageUndergraduates(alumniPage, config, observedAt).undergraduates,
      ),
    ).toBe(withheld);
  });

  it('cites the alumni page on the roster snapshot', () => {
    const roster = extractOfficialResearchHomeRoster(peoplePage, config, observedAt);
    const snapshot = officialRosterObservations(config, roster).find(
      (observation) => observation.field === 'rosterEnrichment',
    );
    expect(snapshot?.value).toMatchObject({ alumniSourceUrl: 'https://alumnilab.yale.edu/alumni' });
  });
});

describe('round-five roster rules (#5245)', () => {
  const observedAt = new Date('2026-10-18T12:00:00Z');
  const headingConfig = (
    currentSectionLabels: string[],
    pastSectionLabels: string[] = [],
  ): OfficialRosterConfig => ({
    researchEntityKey: 'dept-fixture-five',
    url: 'https://fivelab.yale.edu/people',
    template: 'heading-list',
    currentSectionLabels,
    pastSectionLabels,
  });
  const listed = (html: string, rosterConfig: OfficialRosterConfig) =>
    extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
      ({ name, status }) => `${name}:${status}`,
    );

  describe('sections the reader used to miss', () => {
    it('reads people listed before the first heading under the page title', () => {
      const html = `<html><head><title>Team | Fixture Lab</title></head><body><main>
        <p>Avery Quill, undergraduate researcher</p>
        <p>Jordan Alder, PhD student</p>
        <h2>Lab alumni</h2><p>Harper Wren, undergraduate researcher (2021-2023)</p>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Team | Fixture Lab'], ['Lab alumni']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:past',
      ]);
    });

    it('reads person lines written as bare divs', () => {
      const html = `<html><body><main><h2>Undergraduates</h2>
        <div><span>Avery Quill</span></div><div>Plasma reactors</div>
        <h2>Alumni</h2><h4>Undergraduates</h4>
        <div>Harper Wren (2022-2024) - <em>Membranes</em></div>
        <div>Current: PhD Student at Elsewhere University</div>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Undergraduates']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:past',
      ]);
    });

    it('reads a table whose header row is written with td cells, and a name in its second cell', () => {
      const html = `<html><body><main>
        <h3>Alumni:</h3>
        <table><tbody>
          <tr><td><p><strong>Name</strong></p></td><td><p><strong>Role in Lab</strong></p></td><td><p><strong>Current Position</strong></p></td></tr>
          <tr><td>Avery Quill</td><td>Undergraduate</td><td>Analyst</td></tr>
          <tr><td>Jordan Alder</td><td>Post Graduate</td><td>Instructor</td></tr>
        </tbody></table>
        <h3>Undergraduate researchers</h3>
        <table><tbody><tr><td><img src="a.jpg" /></td><td><strong>Harper Wren</strong></td></tr></tbody></table>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Undergraduate researchers'], ['Alumni:']))).toEqual([
        'Avery Quill:past',
        'Harper Wren:current',
      ]);
    });

    it('reads a name heading followed by its singular role heading as one person', () => {
      const html = `<html><body><main><h3>Lab Members:</h3>
        <h4>Jordan Alder, BA</h4><h4>PhD Student</h4>
        <h4>Avery Quill</h4><h4>Undergraduate Researcher</h4>
        <h4>Rowan Thistle</h4><h4>Visiting Undergraduate Researcher</h4>
        <h4>harper wren</h4><h4>Undergraduate Student</h4>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Lab Members:']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:current',
      ]);
    });

    it('keeps people under a caption heading inside the roster section', () => {
      const html = `<html><body><main><h1>lab members</h1>
        <h2>Avery Quill</h2><h3>Undergraduate Student</h3><p>Avery studies splicing.</p>
        <h2>biscuit</h2><h3>Emotional Support Specialist</h3>
        <h2>Harper Wren</h2><h3>Undergraduate Student</h3>
      </main></body></html>`;
      expect(listed(html, headingConfig(['lab members']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:current',
      ]);
    });

    it('reads a bold group label as the next group after a one-role section', () => {
      const html = `<html><body><main><h3>Undergraduate Students</h3>
        <div>Avery Quill<br />avery (at) yale.edu</div>
        <p><strong>Research Collaborators</strong></p>
        <div>Jordan Alder<br />Professor elsewhere</div>
        <h2>Lab Alumni</h2>
        <p><strong>Thesis Students</strong></p>
        <p>Harper Wren (TD ’25), Psychology Senior Thesis Student Fall 2025</p>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Undergraduate Students'], ['Lab Alumni']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:past',
      ]);
    });

    it('reads a person whose role line follows a profile field line', () => {
      const html = `<html><body><main><h2>People & Alumni</h2>
        <p><strong>Avery Quill</strong></p>
        <p>Interests: hiking, baking and bird watching on the weekends with friends Undergraduate Student</p>
        <p><strong>Jordan Alder</strong></p>
        <p>Interests: reading and exploring new places with friends and family Graduate Student</p>
      </main></body></html>`;
      expect(listed(html, headingConfig(['People & Alumni']))).toEqual(['Avery Quill:current']);
    });

    it('reads h4 groups and reference cards on a YaleSites page', () => {
      const yaleSites = (body: string) =>
        `<html><body><main><h2>Former Lab Members</h2>${body}</main></body></html>`;
      const referenceCard = (name: string, subheading = '') =>
        `<li class="reference-card"><h3 class="reference-card__heading"><a href="/profile/x">${name}</a></h3>
          <div class="reference-card__subheading">${subheading}</div></li>`;
      const html = yaleSites(`<h4>Postdocs:</h4><ul>${referenceCard('Jordan Alder, Ph.D.')}</ul>
        <h4>Undergraduates:</h4><ul>${referenceCard('Avery Quill, 2010')}${referenceCard(
          'Harper Wren, 2009',
          'visiting from Elsewhere',
        )}</ul>`);
      expect(
        listed(html, {
          researchEntityKey: 'dept-fixture-five',
          url: 'https://fivelab.yale.edu/people',
          template: 'yalesites-directory',
          currentSectionLabels: [],
          pastSectionLabels: ['Undergraduates:'],
        }),
      ).toEqual(['Avery Quill:past']);
    });

    it('keeps a school caption inside a YaleSites section and leaves out people under another school', () => {
      const html = `<html><body><main><h2>Group Alumni</h2><h3>Undergraduate Students</h3>
        <h4>Yale University</h4><ul><li>Avery Quill<br />Sep. 2019 – May 2021</li></ul>
        <h4>University of Elsewhere-Madison</h4><ul><li>Harper Wren<br />Sep. 2011 – 2013</li></ul>
      </main></body></html>`;
      expect(
        listed(html, {
          researchEntityKey: 'dept-fixture-five',
          url: 'https://fivelab.yale.edu/people',
          template: 'yalesites-directory',
          currentSectionLabels: ['Undergraduate Students'],
        }),
      ).toEqual(['Avery Quill:past']);
    });
  });

  describe('where a person went next is not their own role', () => {
    it('reads a Yale College class year written before a graduate degree as the undergraduate years', () => {
      expect(
        listedEntryRole({ title: '', years: '(Yale College 2022) – Ph.D. at Elsewhere' }, 'Alumni'),
      ).toBe('undergrad');
      expect(
        listedEntryRole(
          { title: '', years: ', Yale ‘22 (in lab 2020-2022) – Last seen: masters program' },
          'Undergraduates',
        ),
      ).toBe('undergrad');
      expect(
        listedEntryRole(
          { title: '', years: ' (undergrad) - graduate research assistant, Elsewhere' },
          'Alumni',
        ),
      ).toBe('undergrad');
      expect(
        listedEntryRole(
          { title: '', years: ' — MD/PhD program at Elsewhere University' },
          'Former Undergraduates',
        ),
      ).toBe('undergrad');
      expect(
        listedEntryRole(
          { title: '', years: 'Undergraduate StudentCurrent Position: Medical Student' },
          'Alumni',
        ),
      ).toBe('undergrad');
    });

    it('reads Yale residential college class years and thesis students as undergraduates', () => {
      expect(
        listedEntryRole(
          { title: '', years: ' (TD ’25), Cognitive Science Thesis Student' },
          'Lab Alumni',
        ),
      ).toBe('undergrad');
      expect(listedEntryRole({ title: '', years: ' (GH ’26)' }, 'Lab Alumni')).toBe('undergrad');
    });
  });

  describe('students from other schools', () => {
    it('ties a person to the school their own line names', () => {
      for (const years of [
        ' — Undergraduate, University of Elsewhere',
        ' (Undergrad, Elsewhere College ’20; Summer 2019)',
        ' | 2024 | Undergraduate Student, Elsewhere University',
        ' (PEB REU undergrad, 2026)',
        ' (Elsewhere (HHMI-REVU) (in lab summer 2019)',
        '(Yale-NUS undergrad, 2024)',
        ' (Yale-National University of Singapore Comp Science BS Candidate)',
        ', Emory Undergraduate Student',
        ', undergraduate researcher. Currently an undergraduate student at Elsewhere College.',
        ' (undergraduate researcher) - Current Institution: Elsewhere College undergraduate student',
        ', ‘22, BS Biology, Elsewhere State University. Now a technician.',
        ', Licenciatura 2022',
        ' 2023-2024 Formerly: undergraduate researcher at Elsewhere',
        'Undergraduate Researcher Elsewhere University',
      ]) {
        expect(listedEntryIsFromAnotherSchool({ name: 'Avery Quill', title: '', years })).toBe(
          true,
        );
      }
    });

    it('does not read a later graduate or professional school, or a Yale college, as the home school', () => {
      for (const years of [
        'Undergraduate Researcher ‘26 Medical student at Elsewhere School of Medicine',
        'Undergraduate Researcher Pierson College',
        'Undergraduate Student at Yale University, New Haven',
        'Undergraduate Student Yale University',
        'Avery Quill Undergraduate Student Bio',
        'Undergraduate Researcher 2018/19 Academic Year',
      ]) {
        expect(listedEntryIsFromAnotherSchool({ name: 'Avery Quill', title: '', years })).toBe(
          false,
        );
      }
    });

    it('leaves out a section headed by another campus of another university', () => {
      const html = `<html><body><main><h3>Undergraduate Students</h3><ul><li>Avery Quill</li></ul>
        <h3>Fixture Lab UW-Elsewhere Alumni</h3><ul><li>Harper Wren, Undergraduate Researcher</li></ul>
      </main></body></html>`;
      expect(
        listed(
          html,
          headingConfig(['Undergraduate Students'], ['Fixture Lab UW-Elsewhere Alumni']),
        ),
      ).toEqual(['Avery Quill:current']);
    });
  });

  describe('telling current from past', () => {
    it('does not read a heading that names current and former members as a past heading', () => {
      const html = `<html><body><main><h3>Current and former group members</h3>
        <p><strong>Current:</strong></p>
        <ul><li>Mr. Avery Quill, Yale undergraduate researcher (fall 2025-present)</li></ul>
        <p><strong>Former:</strong></p>
        <ul><li>Undergraduate students: <ul><li>Ms. Harper Wren, Physics undergraduate researcher (summer 2023-2024)</li></ul></li></ul>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Current and former group members']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:past',
      ]);
    });

    it('reads a lone year as a class year only where the line writes it as one', () => {
      const html = `<html><body><main><h3>Undergraduate students</h3><ul>
        <li>Avery Quill, Lab: Lithium 2023</li>
        <li>Harper Wren (Summer 2022)</li>
        <li>Ellis Juniper (Jan.2020 - May 2023)</li>
      </ul>
      <p><strong>Rowan Thistle</strong><br />BS Environmental Engineering, 2024</p>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Undergraduate students']))).toEqual([
        'Avery Quill:current',
        'Harper Wren:past',
        'Ellis Juniper:past',
        'Rowan Thistle:past',
      ]);
    });
  });

  describe('graduates, postgraduates and staff under a general heading', () => {
    it('reads a degree written after the name as one the person holds', () => {
      expect(
        listedEntryRole({ name: 'Avery Quill', title: '', years: 'Avery Quill, BS' }, 'Our Team'),
      ).toBeNull();
      expect(
        listedEntryRole({ name: 'Avery Quill', title: '', years: ', B.A.' }, 'Alumni'),
      ).toBeNull();
      expect(
        listedEntryRole(
          { name: 'Avery Quill', title: '', years: ', BS - Undergraduate, Yale University' },
          'Alumni',
        ),
      ).toBe('undergrad');
      expect(
        listedEntryRole({ name: 'Avery Quill', title: '', years: ', B.S. 2019' }, 'Alumni'),
      ).toBe('undergrad');
    });

    it("reads a Yale bachelor's held by a former member as their Yale undergraduate years", () => {
      const html = `<html><body><main><h2>Lab Members</h2>
        <p>Ellis Juniper, B.S., Department of Chemistry, Yale University, 2024-present</p>
        <p>Parker Moss, B.S.</p>
        <h2>Lab Alumni</h2>
        <p>Avery Quill, B.S., Department of Molecular Biophysics, Yale University, 2008-2012</p>
        <p>Harper Wren, B.S.</p>
        <p>Rowan Thistle, B.S., Elsewhere State University</p>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Lab Members'], ['Lab Alumni']))).toEqual([
        'Avery Quill:past',
      ]);
    });

    it('reads the dated line under a name in the same paragraph as that person, and not a biography', () => {
      const html = `<html><body><main><h2>Lab Alumni</h2>
        <p><strong>Avery Quill</strong>, B.S.<br />Department of Molecular Biophysics &amp; Biochemistry, Yale University, 2008-2012. PhD at Elsewhere University. Currently a postdoc elsewhere.</p>
        <p><strong>Harper Wren</strong><br />Ms. Wren is working with her mentor on inflammation and loves to cook in her free time with friends.</p>
      </main></body></html>`;
      expect(
        extractOfficialResearchHomeRoster(html, headingConfig([], ['Lab Alumni']), observedAt)
          .undergraduates,
      ).toEqual([{ name: 'Avery Quill', status: 'past', startYear: 2008, endYear: 2012 }]);
    });

    it('reads postgraduate roles, a junior job title, a post doc, nursing degrees and a director of undergraduate studies', () => {
      expect(
        listedEntryRole({ title: '', years: ', B.S. Yale Postgrad' }, 'Meet the Team'),
      ).toBeNull();
      expect(listedEntryRole({ title: '', years: ', B.S. Yale PGA' }, 'Meet the Team')).toBeNull();
      expect(
        listedEntryRole(
          { title: '', years: ' Postgraduate Student BS (Biology) Elsewhere University' },
          'Members',
        ),
      ).toBeNull();
      expect(listedEntryRole({ title: '', years: ' (post-graduate associate)' }, 'Team')).toBe(
        'staff',
      );
      expect(
        listedEntryRole(
          { title: '', years: ' (Junior AI Scientist, Fixture Co)' },
          'Students Supervised',
        ),
      ).toBeNull();
      expect(
        listedEntryRole({ title: '', years: ' (rising junior majoring in physics)' }, 'Team'),
      ).toBe('undergrad');
      expect(listedEntryRole({ title: '', years: '. post doc, 2008-2010' }, 'Alumni')).toBe(
        'postdoc',
      );
      expect(
        listedEntryRole({ title: '', years: ', MSN, PMHNP (Class of 2025)' }, 'Lab Alumni'),
      ).toBeNull();
      expect(
        mapOfficialRosterRole(
          'Professor of Linguistics; Director of Undergraduate Studies',
          'Members',
        ),
      ).toBe('core-faculty');
    });

    it('does not list as a current undergraduate someone the page also lists in a current graduate role', () => {
      const html = `<html><body><main><h2>Our Team</h2>
        <ul><li>Avery Quill, Postgraduate Associate</li><li>Harper Wren, Undergraduate Student</li></ul>
        <h3>Students</h3><ul><li>Avery Quill, Undergraduate Student</li></ul>
      </main></body></html>`;
      expect(listed(html, headingConfig(['Our Team', 'Students']))).toEqual([
        'Harper Wren:current',
      ]);
    });
  });

  describe('names', () => {
    it('takes a bold or linked lead as the name only when the line opens with it', () => {
      const html = `<html><body><main><h3>Alumni</h3>
        <p>Avery Quill, 2024-2025 Yale Undergraduate. <a href="/x">Google Scholar Page</a></p>
        <p>Harper Wren (SY ‘23), Cognitive Science Thesis Student; now at <a href="/y">Fixture AI</a></p>
        <p><strong>Rowan Thistle,</strong> MPharm, PhD<br />Postdoctoral Associate (2021-2025)</p>
      </main></body></html>`;
      expect(listed(html, headingConfig([], ['Alumni']))).toEqual([
        'Avery Quill:past',
        'Harper Wren:past',
      ]);
    });

    it('refuses a sentence fragment and strips honorifics and leading symbols', () => {
      expect(looksLikeListedPersonName('Avery is originally from Springfield')).toBe(false);
      expect(looksLikeListedPersonName('Ana María de la Cruz')).toBe(true);
      expect(looksLikeListedPersonName('★Avery Quill')).toBe(true);
      expect(
        listed(
          `<html><body><main><h3>Students Supervised</h3><ul>
            <li>★Avery Quill (undergraduate, Yale University)</li><li>Ms. Harper Wren, Yale undergraduate</li>
          </ul></main></body></html>`,
          headingConfig(['Students Supervised']),
        ),
      ).toEqual(['Avery Quill:current', 'Harper Wren:current']);
    });

    it('does not read a name heading as a section heading', () => {
      const html = `<html><body><main><h2>Former Members</h2>
        <h3>Undergraduates</h3>
        <h3>Avery Quill, 2010</h3><p>Biology</p>
        <h3>Harper Wren, 2009</h3>
      </main></body></html>`;
      expect(listed(html, headingConfig([], ['Undergraduates']))).toEqual([
        'Avery Quill:past',
        'Harper Wren:past',
      ]);
    });
  });
});
