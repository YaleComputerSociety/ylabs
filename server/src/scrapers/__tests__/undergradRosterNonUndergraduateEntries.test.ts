import { describe, expect, it } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import { pageOwnershipRefusal } from '../undergradRosterDerivation';

const observedAt = new Date('2026-10-19T12:00:00Z');

const config = (overrides: Partial<OfficialRosterConfig> = {}): OfficialRosterConfig => ({
  researchEntityKey: 'dept-fixture-roster',
  url: 'https://fixturelab.yale.edu/people',
  template: 'heading-list',
  currentSectionLabels: ['Current Members'],
  pastSectionLabels: ['Former Members'],
  ...overrides,
});

const listed = (html: string, rosterConfig = config()): string[] =>
  extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
    ({ name, status }) => `${name}:${status}`,
  );

const body = (main: string): string => `<html><body><main>${main}</main></body></html>`;

describe('entries that are not people', () => {
  it('reads the value under a hometown label as part of the card above it', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2>
          <h3><strong>Rowan Thistle</strong></h3><p><strong>Postdoctoral Fellow</strong></p>
          <p><strong>HOMETOWN<br></strong>Harbor Vale, Elsewhere</p>
          <p><strong>EDUCATION<br></strong>BS Biology - Elsewhere University - 2014</p>
          <h3><strong>Avery Quill</strong></h3><p>Undergraduate Researcher, Yale College '27</p>`),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('never lists a contact or postal address label as a person', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2><p>Avery Quill (Physics, Yale College, 2027)</p>
          <p>U.S. Postal Address: Department of Fixtures | P. O. Box 1 | New Haven, CT</p>
          <p>Shipping Address: 1 Fixture Avenue | New Haven, CT</p>`),
        config({ currentSectionLabels: ['Undergraduate Students'] }),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('reads a heading that offers resources to undergraduates as no roster at all', () => {
    expect(
      listed(
        body(`<h2>Explore Writing Resources for Undergraduates</h2>
          <p>Model Papers</p><p>Principles Of Citing Sources</p>`),
        config({ currentSectionLabels: ['Explore Writing Resources for Undergraduates'] }),
      ),
    ).toEqual([]);
  });

  it('collapses a name a page set twice with no separator', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2><p>Avery QuillAvery Quill</p><p>Undergraduate</p>
          <p>Harper Wren Harper Wren</p><p>Undergraduate</p>`),
      ),
    ).toEqual(['Avery Quill:current', 'Harper Wren:current']);
  });
});

describe('people listed as undergraduates who are not', () => {
  it('never reads a lab head, a doctor or a staff member as an undergraduate', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2>
          <p>Rowan Thistle, PhD. Rowan trained as a physicist in both her undergraduate and graduate studies.</p>
          <p>Prof. Ellis Juniper | Department of Fixtures</p>
          <p>Jordan AlderSenior Administrative Assistant. After earning a B.A. from Elsewhere, Jordan joined the center.</p>
          <p>Avery Quill (Undergraduate, Yale College '27)</p>`),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it("reads a former member's M. Ph. as a graduate degree", () => {
    expect(
      listed(
        body(`<h2>Former Members</h2><ul><li>Rowan Thistle (M. Ph. Yale '09)</li>
          <li>Avery Quill (B.S. Yale '09)</li></ul>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Former Members'] }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('leaves out a lone linked name after a bulleted list ends', () => {
    expect(
      listed(
        body(`<h2>Former Undergraduates</h2><table><tr><td><ul>
            <li><a href="/avery-quill">Avery Quill</a> - Currently at Elsewhere Corp</li>
            <li>Harper Wren - MD program at Elsewhere</li>
          </ul></td></tr></table>
          <p><a href="/rowan-thistle">Rowan Thistle</a></p>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Former Undergraduates'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Harper Wren:past']);
  });

  it('still reads card lines inside list items and paragraphs after a bulleted share bar', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2>
          <li class="card"><h3>Avery Quill</h3><p>Undergraduate Researcher</p><p>Yale College '27</p></li>
          <li class="card"><h3>Harper Wren</h3><p>Undergraduate Researcher</p><p>Yale College '28</p></li>`),
      ),
    ).toEqual(['Avery Quill:current', 'Harper Wren:current']);
    expect(
      listed(
        body(`<h2>Former Members</h2><ul><li><button aria-label="Share"></button></li>
          <li><button aria-label="Print"></button></li></ul>
          <p>Avery Quill, BS - Undergraduate, Yale University, New Haven, CT</p>
          <p>Harper Wren, BS - Undergraduate, Yale University, New Haven, CT</p>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Former Members'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Harper Wren:past']);
  });
});

describe('visiting, summer-program and other-school undergraduates', () => {
  const currentOnly = config({ currentSectionLabels: ['Current Members'] });

  it('withholds every listing of a person any listing places at another school', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2>
          <h3>Avery Quill</h3><p>Fixture Summer Undergraduate Research Assistant</p>
          <p>Avery Quill (she/her) is an undergraduate Biology student at Elsewhere University.</p>
          <h3>Harper Wren</h3><p>Undergraduate Researcher, Yale College '27</p>`),
        currentOnly,
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('withholds a summer trainee, a degree from another school and a one-word school', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2><ul>
          <li>Avery Quill, (Undergraduate Student Summer Trainee with a fellowship from Elsewhere)</li>
          <li>Rowan Thistle, BS/BA, Sewanee: University of the South, '24</li>
          <li>Ellis Juniper - Rawlings Cornell Presidential Undergraduate Research Scholar</li>
          <li>Jordan Alder (Biophysics, University of Elsewhere, 2026)</li>
          <li>Harper Wren (Physics, Yale College, 2027)</li>
        </ul>`),
        currentOnly,
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('reads a hometown or a glued Yale residential college line as no other school', () => {
    expect(
      listed(
        body(`<h2>Current Members</h2>
          <h3>Avery Quill</h3><p>Undergraduate Student</p>
          <p>Avery Quill is a sophomore from Harbor Vale, CT, majoring in Chemistry.</p>
          <h3>Harper Wren</h3><p>Undergraduate ResearcherSaybrook CollegeYale College '28</p>`),
        currentOnly,
      ),
    ).toEqual(['Avery Quill:current', 'Harper Wren:current']);
  });
});

describe('pages that belong to another lab or institution', () => {
  const team = (title: string, main: string): string =>
    `<html><head><title>${title}</title></head><body><nav><a href="/">${title.replace(/ - .*$/, '')}</a></nav><main>${main}</main></body></html>`;

  it("refuses a person's row on a page whose named lab head is someone it never lists", () => {
    const html = team(
      'Team - Fixture Lab',
      `<h2>Faculty</h2><p>Rowan Thistle</p><p>Principal Investigator</p>
       <h2>Undergraduate Students</h2><ul><li>Harper Wren</li><li>Jordan Alder</li></ul>`,
    );
    expect(
      pageOwnershipRefusal(html, 'ysm-faculty-avery-quill', 'https://fixture-lab.example.io/team/'),
    ).toBe('page-of-another-lab');
    expect(
      pageOwnershipRefusal(
        html.replace('<h2>Faculty</h2>', '<h2>Faculty</h2><p>Avery Quill, Co-Director</p>'),
        'ysm-faculty-avery-quill',
        'https://fixture-lab.example.io/team/',
      ),
    ).toBeUndefined();
    expect(
      pageOwnershipRefusal(
        html.replace('Principal Investigator', "Lab Director's Assistant"),
        'ysm-faculty-avery-quill',
        'https://fixture-lab.example.io/team/',
      ),
    ).toBeUndefined();
  });

  it('refuses an off-Yale page that names Yale only in its site title and places its undergraduates elsewhere', () => {
    const html = team(
      'The Fixture Lab | Yale | MB&B - People',
      `<h2>People</h2><p>Avery Quill</p><p>Rawlings Cornell Presidential Undergraduate Research Scholar</p>
       <p>Harper Wren</p><p>Undergraduate</p>`,
    );
    expect(
      pageOwnershipRefusal(
        html,
        'nih-pi-rowan-thistle',
        'https://sites.example.com/fixturelab/people',
      ),
    ).toBe('page-of-another-institution');
    expect(
      pageOwnershipRefusal(
        html.replace('<h2>People</h2>', '<h2>People</h2><p>We are at Yale.</p>'),
        'nih-pi-rowan-thistle',
        'https://sites.example.com/fixturelab/people',
      ),
    ).toBeUndefined();
  });
});
