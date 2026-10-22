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

const profileCard = (name: string, title: string, bio: string): string => `
  <article class="profile-grid-item" aria-label="${name}'s Profile">
    <div class="profile-grid-item__name-container"><span class="profile-grid-item__name">${name}</span></div>
    <div class="profile-grid-item__title-container"><p class="profile-grid-item__title">${title}</p></div>
    <div class="profile-grid-item__bio-container"><div class="profile-grid-item__bio">${bio}</div></div>
  </article>`;

const profileGrid = (label: string, cards: string): string =>
  body(`<section class="organization-member-listing" aria-label="${label}">${cards}</section>`);

describe('other-school entries the derivation measurement found (#5416)', () => {
  it('reads a bracketed school after a year where the section brackets each home school', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students:</h2>
          <p>Avery Quill, 2016-2017 (Yale)</p><p>Harper Wren, 2015-2017 (Yale)</p><p>Jordan Alder, 2014-2015 (Yale)</p>
          <p>Rowan Thistle, 2016 (U. of Elsewhere). Current position: founder</p>
          <p>Ellis Juniper, 2016, (U. of Fixture)</p>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Undergraduate Students:'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Harper Wren:past', 'Jordan Alder:past']);
  });

  it('reads a table column of schools as each undergraduate home school', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2><table>
          <tr><td>Avery Quill</td><td>Jan.2014 - May.2015</td><td>Yale University</td></tr>
          <tr><td>Rowan Thistle</td><td>Aug.2010 - May.2012 / Presidential Undergraduate Research Award</td><td>Elsewhere Institute of Technology</td></tr>
          <tr><td>Ellis Juniper</td><td>Aug.2008 - May.2009</td><td>Elsewhere Institute of Technology</td></tr>
        </table>`),
        config({
          template: 'yalesites-directory',
          currentSectionLabels: ['Undergraduate Students'],
        }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('reads a table column of residential colleges as Yale', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2><table>
          <tr><td>Avery Quill</td><td>Branford College</td></tr>
          <tr><td>Rowan Thistle</td><td>Silliman College</td></tr>
          <tr><td>Ellis Juniper</td><td>Pauli Murray College</td></tr>
        </table>`),
        config({ currentSectionLabels: ['Undergraduate Students'] }),
      ),
    ).toEqual(['Avery Quill:current', 'Rowan Thistle:current', 'Ellis Juniper:current']);
  });

  it('reads a table column of Yale-NUS College as another school', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2><table>
          <tr><td>Avery Quill</td><td>Yale University</td></tr>
          <tr><td>Rowan Thistle</td><td>Yale-NUS College</td></tr>
          <tr><td>Ellis Juniper</td><td>Yale-NUS College</td></tr>
        </table>`),
        config({ currentSectionLabels: ['Undergraduate Students'] }),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('never reads a headed column of where alumni went next as their home school', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Alumni</h2><table>
          <tr><th>Name</th><th>Years</th><th>Current Position</th></tr>
          <tr><td>Avery Quill</td><td>2019-2021</td><td>Elsewhere University</td></tr>
          <tr><td>Rowan Thistle</td><td>2018-2020</td><td>Fixture Institute of Technology</td></tr>
        </table>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Undergraduate Alumni'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Rowan Thistle:past']);
  });

  it('withholds a former member who left to finish an undergraduate degree elsewhere', () => {
    expect(
      listed(
        body(`<h2>Former Members</h2><ul>
          <li>Rowan Thistle (2025, undergraduate researcher) (subsequent position: finishing up at University of Elsewhere undergrad)</li>
          <li>Avery Quill (2024) (Yale undergraduate; subsequent position: biotechnology company)</li>
        </ul>`),
        config({ currentSectionLabels: [] }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('withholds an undergraduate whose own title names another school in brackets', () => {
    expect(
      listed(
        body(`<h2>Alumni</h2><table>
          <tr><th>Name</th><th>Position</th><th>Years</th></tr>
          <tr><td>Rowan Thistle</td><td>Undergraduate Student (Elsewhere University, Dept of Chemistry)</td><td>2019-2021</td></tr>
          <tr><td>Avery Quill</td><td>Undergraduate Student (Environmental Studies)</td><td>2019-2021</td></tr>
        </table>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Alumni'] }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('withholds a summer undergraduate, but not a Yale undergraduate who researched over the summer', () => {
    expect(
      listed(
        profileGrid(
          'Former Lab Members',
          profileCard('Rowan Thistle', 'Summer Undergraduate 2025', '') +
            profileCard('Avery Quill', 'Undergraduate Researcher 2025 Summer', ''),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: [],
          pastSectionLabels: ['Former Lab Members'],
        }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it("reads a profile card's biography for a bachelor's degree from another school", () => {
    expect(
      listed(
        profileGrid(
          'Our Team',
          profileCard(
            'Rowan Thistle',
            'Undergraduate Research Assistant (2023-2024)',
            '<p>Education &amp; Training: B.S. in Psychology from Elsewhere University (2024)</p>',
          ) +
            profileCard(
              'Avery Quill',
              'Undergraduate Research Assistant',
              '<p>Avery is a Yale College junior majoring in Psychology.</p>',
            ),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: ['Our Team'],
        }),
      ),
    ).toEqual(['Avery Quill:current']);
  });
});

describe('undergraduates whose class year has passed (#5416)', () => {
  it('lists a biography that says the student is graduating in a passed year as past', () => {
    expect(
      listed(
        profileGrid(
          'Fellows and Associates',
          profileCard(
            'Rowan Thistle',
            '',
            '<p>Rowan is an economics major at Yale College graduating in 2022.</p>',
          ) +
            profileCard(
              'Avery Quill',
              '',
              '<p>Avery is an economics major at Yale College graduating in 2028.</p>',
            ) +
            profileCard(
              'Harper Wren',
              '',
              '<p>Harper is a Yale College sophomore who graduated from high school in 2024.</p>',
            ),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: ['Fellows and Associates'],
        }),
      ),
    ).toEqual(['Rowan Thistle:past', 'Avery Quill:current', 'Harper Wren:current']);
  });

  it('reads an expected graduation and a Yale graduation but not another school', () => {
    expect(
      listed(
        profileGrid(
          'Fellows and Associates',
          profileCard(
            'Rowan Thistle',
            '',
            '<p>Rowan studied chemistry, with expected graduation in 2023.</p>',
          ) +
            profileCard(
              'Avery Quill',
              '',
              '<p>Avery graduated from Yale College in 2024 with a degree in history.</p>',
            ) +
            profileCard(
              'Harper Wren',
              '',
              '<p>Harper is a Yale College junior, graduating in 2022 from a preparatory academy.</p>',
            ) +
            profileCard(
              'Sage Moraine',
              '',
              '<p>Sage is a Yale College student, expected graduation 2029.</p>',
            ),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: ['Fellows and Associates'],
        }),
      ),
    ).toEqual([
      'Rowan Thistle:past',
      'Avery Quill:past',
      'Harper Wren:current',
      'Sage Moraine:current',
    ]);
  });

  it('lists a profile card whose biography gives a passed class year as past', () => {
    expect(
      listed(
        profileGrid(
          'Undergraduate Students',
          profileCard(
            'Rowan Thistle',
            '',
            '<p>Rowan is a class of 2025 Yale College student.</p>',
          ) +
            profileCard('Avery Quill', '', '<p>Avery is a class of 2028 Yale College student.</p>'),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: ['Undergraduate Students'],
        }),
      ),
    ).toEqual(['Rowan Thistle:past', 'Avery Quill:current']);
  });

  it('never reads a high-school class year in a biography as the Yale class year', () => {
    expect(
      listed(
        profileGrid(
          'Undergraduate Students',
          profileCard(
            'Avery Quill',
            '',
            '<p>Avery is a Yale College first-year. Avery graduated from Harbor High School, class of 2025.</p>',
          ),
        ),
        config({
          template: 'profile-grid',
          currency: 'section-label',
          currentSectionLabels: ['Undergraduate Students'],
        }),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('reads a class year bulleted under a name heading as that person’s own', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2>
          <h3>Rowan Thistle</h3><ul><li>Biomedical Engineering (Class of 2023)</li></ul>
          <p><strong>Hometown:</strong> Harbor Vale, CT</p>
          <h3>Avery Quill</h3><ul><li>Biomedical Engineering (Class of 2028)</li></ul>`),
        config({ currentSectionLabels: ['Undergraduate Students'] }),
      ),
    ).toEqual(['Rowan Thistle:past', 'Avery Quill:current']);
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
