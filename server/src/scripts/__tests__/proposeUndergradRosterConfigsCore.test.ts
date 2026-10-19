import { describe, expect, it } from 'vitest';
import {
  isProposableSectionLabel,
  labSitePageLinks,
  officialRosterConfigSource,
  pageOwnershipRefusal,
  proposeUndergradRosterConfig,
  renderUndergradRosterReviewSheet,
} from '../proposeUndergradRosterConfigsCore';

const observedAt = new Date('2026-10-14T00:00:00Z');

const headingPage = `<html><body><main>
  <h2>Graduate Students</h2>
  <ul><li>Jordan Alder</li></ul>
  <h2>Undergraduate Researchers</h2>
  <ul><li>Ellis Juniper (2023-present)</li><li>Harper Wren (2024-current)</li></ul>
  <h2>Undergraduate Alumni</h2>
  <ul><li>Indigo Sorrel (2020-2022)</li></ul>
</main></body></html>`;

describe('proposeUndergradRosterConfig', () => {
  it('proposes current and past headings from the sections that list undergraduates', () => {
    const outcome = proposeUndergradRosterConfig(
      headingPage,
      'dept-fixture-group',
      'https://fixturegroup.yale.edu/team',
      observedAt,
    );

    expect(outcome.kind).toBe('proposed');
    if (outcome.kind !== 'proposed') return;
    expect(outcome.proposal.config).toEqual({
      researchEntityKey: 'dept-fixture-group',
      url: 'https://fixturegroup.yale.edu/team',
      template: 'heading-list',
      currentSectionLabels: ['Undergraduate Researchers'],
      pastSectionLabels: ['Undergraduate Alumni'],
    });
    expect(outcome.proposal.current.map((member) => member.name)).toEqual([
      'Ellis Juniper',
      'Harper Wren',
    ]);
    expect(outcome.proposal.past.map((member) => member.name)).toEqual(['Indigo Sorrel']);
  });

  it('never proposes a department undergraduate program page as a lab roster', () => {
    expect(
      proposeUndergradRosterConfig(
        headingPage,
        'dept-fixture-group',
        'https://fixturedept.yale.edu/undergraduates',
        observedAt,
      ),
    ).toEqual({ kind: 'no-undergraduate-section' });
  });

  it('proposes nothing for a page that only mentions undergraduates in prose', () => {
    expect(
      proposeUndergradRosterConfig(
        '<html><body><main><h2>Join us</h2><p>Undergraduates are welcome.</p></main></body></html>',
        'dept-fixture-prose',
        'https://fixtureprose.yale.edu/join',
        observedAt,
      ),
    ).toEqual({ kind: 'no-undergraduate-section' });
  });

  it('lets a profile-grid page take its currency from the section label', () => {
    const html = `<html><head><meta property="publish-date" content="9/17/2024" /></head><body>
      <section class="organization-member-listing" aria-label="Undergraduate Students">
        <article class="profile-grid-item">
          <a class="profile-grid-item__link-details" href="/lab/fixture/profile/avery-quill/">
            <span class="profile-grid-item__name">Avery Quill</span>
          </a>
          <p class="profile-grid-item__title">Undergraduate Student</p>
        </article>
      </section>
    </body></html>`;
    const outcome = proposeUndergradRosterConfig(
      html,
      'ysm-fixture',
      'https://medicine.yale.edu/lab/fixture/people/',
      observedAt,
    );

    expect(outcome.kind).toBe('proposed');
    if (outcome.kind !== 'proposed') return;
    expect(outcome.proposal.config.currency).toBe('section-label');
    expect(outcome.proposal.current).toHaveLength(1);
  });
});

describe('isProposableSectionLabel', () => {
  it('refuses recruiting headings, alumni position lines and singular card titles', () => {
    expect(isProposableSectionLabel('Undergraduate Opportunities', 'heading-list')).toBe(false);
    expect(
      isProposableSectionLabel(
        'Current position: Undergraduate student at another university',
        'heading-list',
      ),
    ).toBe(false);
    expect(isProposableSectionLabel('Undergraduate Researcher', 'heading-list')).toBe(false);
    expect(isProposableSectionLabel('Undergraduate Researchers', 'heading-list')).toBe(true);
    expect(isProposableSectionLabel('Lab Members', 'profile-grid')).toBe(true);
    expect(
      isProposableSectionLabel(
        'Post Baccalaureate and Undergraduate Research Project Students',
        'heading-list',
      ),
    ).toBe(true);
    expect(
      isProposableSectionLabel(
        'Research Assistants: Undergraduate Students',
        'yalesites-directory',
      ),
    ).toBe(true);
  });
});

describe('review sheet and config source', () => {
  const outcome = proposeUndergradRosterConfig(
    headingPage,
    'dept-fixture-group',
    'https://fixturegroup.yale.edu/team',
    observedAt,
  );
  const proposal = outcome.kind === 'proposed' ? { id: 1, ...outcome.proposal } : undefined;

  it('numbers each lab and lists its undergraduates with their years', () => {
    const sheet = renderUndergradRosterReviewSheet([proposal!]);

    expect(sheet).toContain('## 1. dept-fixture-group');
    expect(sheet).toContain('- Ellis Juniper (2023 - present)');
    expect(sheet).toContain('- Indigo Sorrel (2020 - 2022)');
    expect(sheet).not.toMatch(/—/);
  });

  it('emits an approved config as an allowlist entry', () => {
    expect(officialRosterConfigSource([proposal!.config])).toBe(
      [
        '  {',
        '    researchEntityKey: "dept-fixture-group",',
        '    url: "https://fixturegroup.yale.edu/team",',
        '    template: "heading-list",',
        '    currentSectionLabels: ["Undergraduate Researchers"],',
        '    pastSectionLabels: ["Undergraduate Alumni"],',
        '  },',
      ].join('\n'),
    );
  });
});

describe('labSitePageLinks', () => {
  it('finds people and alumni pages inside the lab section of a shared host only', () => {
    const html = `
      <a href="/lab/fixture/people/">People</a>
      <a href="/lab/fixture/alumni">Alumni</a>
      <a href="/lab/other-lab/people/">Neighbour</a>
      <a href="/genetics/people">Department people</a>
      <a href="https://elsewhere.example/team">Off host</a>`;

    expect(labSitePageLinks(html, 'https://medicine.yale.edu/lab/fixture/')).toEqual({
      peoplePages: ['https://medicine.yale.edu/lab/fixture/people/'],
      alumniPages: ['https://medicine.yale.edu/lab/fixture/alumni'],
    });
  });

  it('accepts any same-host people page on a lab that owns its host', () => {
    const html = `<a href="/our-team">Team</a><a href="https://www.fixturelab.yale.edu/lab-members-2">Members</a>
      <a href="/research">Research</a>`;

    expect(labSitePageLinks(html, 'https://fixturelab.yale.edu/').peoplePages).toEqual([
      'https://fixturelab.yale.edu/our-team',
      'https://www.fixturelab.yale.edu/lab-members-2',
    ]);
  });
});

describe('pageOwnershipRefusal (#5245)', () => {
  const teamPage = (title: string, body: string) =>
    `<html><head><title>${title}</title></head><body><main><h2>Our Team</h2>${body}
      <h2>Undergraduate Researchers</h2><ul><li>Ellis Juniper (2024-present)</li></ul>
      <p>Part of Yale University.</p></main></body></html>`;

  it("refuses a person's key on a lab page named after someone else the page lists", () => {
    const html = teamPage(
      'Team — Thistle Lab',
      '<ul><li>Rowan Thistle, Principal Investigator</li><li>Avery Quill, Postdoctoral Fellow</li></ul>',
    );
    expect(
      pageOwnershipRefusal(html, 'ysm-faculty-avery-quill', 'https://www.thistlelab.org/team'),
    ).toBe('page-of-another-lab');
    expect(
      proposeUndergradRosterConfig(
        html,
        'ysm-faculty-avery-quill',
        'https://www.thistlelab.org/team',
        observedAt,
      ),
    ).toEqual({ kind: 'page-of-another-lab' });
    expect(
      pageOwnershipRefusal(html, 'ysm-faculty-rowan-thistle', 'https://www.thistlelab.org/team'),
    ).toBeUndefined();
  });

  it('does not read a descriptive lab name or a lab-keyed row as another lab', () => {
    const html = teamPage(
      'Team — Uplift Lab',
      '<ul><li>Rowan Thistle, Principal Investigator</li></ul>',
    );
    expect(
      pageOwnershipRefusal(html, 'ysm-faculty-rowan-thistle', 'https://www.upliftlab.org/team'),
    ).toBeUndefined();
    expect(
      pageOwnershipRefusal(
        teamPage('Team — Thistle Lab', '<ul><li>Rowan Thistle, PI</li></ul>'),
        'fixture-lab-ab12',
        'https://www.thistlelab.org/team',
      ),
    ).toBeUndefined();
  });

  it('refuses an off-Yale page that never names Yale and keeps naming one other university', () => {
    const html = `<html><head><title>Team — Fixture Lab</title></head><body><main>
      <h2>Alumni</h2><ul>
        <li>Avery Quill, Undergraduate in Bioengineering, University of Elsewhere</li>
        <li>Harper Wren, undergraduate student at University of Elsewhere</li>
        <li>Rowan Thistle, now a graduate student at University of Elsewhere</li>
      </ul></main></body></html>`;
    expect(
      pageOwnershipRefusal(html, 'fixture-lab-ab12', 'https://fixturelab.example.com/team'),
    ).toBe('page-of-another-institution');
    expect(
      pageOwnershipRefusal(
        html.replace('<main>', '<main><p>A Yale lab.</p>'),
        'fixture-lab-ab12',
        'https://fixturelab.example.com/team',
      ),
    ).toBeUndefined();
    expect(
      pageOwnershipRefusal(html, 'fixture-lab-ab12', 'https://fixturelab.yale.edu/team'),
    ).toBeUndefined();
  });
});
