import { describe, it, expect } from 'vitest';
import {
  findPiUserIdForLabFromCandidates,
  findPiUserIdsForLabFromCandidates,
  mergeUserProfileUrlObservations,
  piProfileUserObservationsFromProfiles,
  labToObservations,
  parseLabs,
  parseDepartmentsFromLabHtml,
  parsePrincipalInvestigatorProfilesFromLabHtml,
  piNameKeyFromLabUrl,
} from '../sources/ysmAtoZScraper';

const SAMPLE_HTML = `
<html><body>
<table>
  <tbody>
    <tr><td><a href="https://medicine.yale.edu/lab/3d-fixture-lab/">3D Fixture Lab</a></td><td>https://medicine.yale.edu/lab/3d-fixture-lab/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/example-digital/">Example's Digital Methods Lab</a></td><td>https://medicine.yale.edu/lab/example-digital/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/northstar/">Northstar Lab</a></td><td>https://medicine.yale.edu/lab/northstar/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/beacon/">Beacon Laboratory of Synthetic Signals</a></td><td>https://medicine.yale.edu/lab/beacon/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/synthetic-lab-news-blog/">Synthetic Lab News Blog</a></td><td>https://medicine.yale.edu/lab/synthetic-lab-news-blog/</td></tr>
    <tr><td><a href="">Empty URL Lab</a></td><td></td></tr>
    <tr><td>No Link Lab</td><td>not a url</td></tr>
  </tbody>
</table>
</body></html>
`;

function slugifyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/lab\/([^/]+)/i);
    if (m && m[1]) return `ysm-${m[1].toLowerCase()}`;
  } catch {
    /* swallow */
  }
  return null;
}

function inferPiSurname(name: string): string | null {
  const stripped = name.trim().replace(/['']s\b/g, '');
  const tokens = stripped.split(/\s+/);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx > 0) {
    const candidate = tokens[labIdx - 1];
    if (/^[A-Z][a-zA-Z\-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  return tokens[0] && /^[A-Z][a-zA-Z\-]+$/.test(tokens[0]) ? tokens[0] : null;
}

describe('YsmAtoZ HTML parsing', () => {
  it('extracts only rows with a valid URL and name', () => {
    const labs = parseLabs(SAMPLE_HTML);
    expect(labs).toHaveLength(4);
    expect(labs.map((l) => l.name)).toEqual([
      '3D Fixture Lab',
      "Example's Digital Methods Lab",
      'Northstar Lab',
      'Beacon Laboratory of Synthetic Signals',
    ]);
  });

  it('skips rows with empty URLs or non-URL second columns', () => {
    const labs = parseLabs(SAMPLE_HTML);
    expect(labs.find((l) => l.name === 'Empty URL Lab')).toBeUndefined();
    expect(labs.find((l) => l.name === 'No Link Lab')).toBeUndefined();
  });

  it('skips content pages that appear in the lab websites index', () => {
    const labs = parseLabs(SAMPLE_HTML);
    expect(labs.find((l) => l.name === 'Synthetic Lab News Blog')).toBeUndefined();
  });

  it('skips the lab websites index page itself when it appears as a row link', () => {
    const labs = parseLabs(`
      <html><body><table><tbody>
        <tr>
          <td><a href="https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/">Lab Websites</a></td>
        </tr>
        <tr>
          <td><a href="https://medicine.yale.edu/lab/northstar/">Northstar Lab</a></td>
        </tr>
      </tbody></table></body></html>
    `);

    expect(labs.map((l) => l.url)).toEqual(['https://medicine.yale.edu/lab/northstar/']);
  });
});

describe('parseDepartmentsFromLabHtml', () => {
  it('extracts source-backed department breadcrumbs from YSM lab pages', () => {
    const html = `
      <nav class="department-header__breadcrumbs">
        <ul>
          <li><a>Yale School of Medicine</a><span>/</span></li>
          <li><a>Fixture Medicine</a><span>/</span></li>
          <li><a>Synthetic Methods Program</a><span>/</span></li>
        </ul>
      </nav>
    `;

    expect(parseDepartmentsFromLabHtml(html, 'Synthetic Breadcrumb Lab')).toEqual([
      'Fixture Medicine',
      'Synthetic Methods Program',
      'Yale School of Medicine',
    ]);
  });

  it('omits lab names and empty breadcrumb chrome', () => {
    const html = `
      <nav class="department-header__breadcrumbs">
        <ul>
          <li><a>Yale School of Medicine</a><span>/</span></li>
          <li><a>Synthetic Imaging Department</a><span>/</span></li>
          <li><a>Neuro Signal Atlas Project</a><span>/</span></li>
        </ul>
      </nav>
    `;

    expect(parseDepartmentsFromLabHtml(html, 'Neuro Signal Atlas Project')).toEqual([
      'Synthetic Imaging Department',
      'Yale School of Medicine',
    ]);
  });
});

describe('slugifyFromUrl', () => {
  it('extracts the path segment after /lab/ as the slug seed', () => {
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/northstar/')).toBe('ysm-northstar');
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/3d-fixture-lab/')).toBe('ysm-3d-fixture-lab');
  });

  it('returns null for URLs without /lab/', () => {
    expect(slugifyFromUrl('https://medicine.yale.edu/research/')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(slugifyFromUrl('not a url')).toBeNull();
  });
});

describe('inferPiSurname', () => {
  it('extracts the surname before "Lab"', () => {
    expect(inferPiSurname('Northstar Lab')).toBe('Northstar');
    expect(inferPiSurname('Vector Lab')).toBe('Vector');
  });

  it("strips possessive apostrophe-s", () => {
    expect(inferPiSurname("Example's Digital Methods Lab")).toBeTruthy();
  });

  it('extracts surname before "Laboratory"', () => {
    expect(inferPiSurname('Beacon Laboratory of Synthetic Signals')).toBe('Beacon');
  });

  it('returns null for descriptive-only names', () => {
    expect(inferPiSurname('3D Fixture Lab')).not.toBe('3D');
  });
});

describe('piNameKeyFromLabUrl', () => {
  it('extracts compact person-name keys from YSM lab URL slugs', () => {
    expect(piNameKeyFromLabUrl('https://medicine.yale.edu/lab/arifixture/')).toBe('arifixture');
  });

  it('does not treat descriptive lab slugs as person-name keys', () => {
    expect(piNameKeyFromLabUrl('https://medicine.yale.edu/lab/3d-fixture-lab/')).toBeNull();
    expect(piNameKeyFromLabUrl('https://medicine.yale.edu/lab/digital-methods-lab/')).toBeNull();
  });
});

describe('findPiUserIdForLabFromCandidates', () => {
  it('uses a compact URL name key to disambiguate acronym lab names', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Synthetic Climate Nexus (SCN) Lab',
        url: 'https://medicine.yale.edu/lab/arifixture/',
        slug: 'ysm-arifixture',
      },
      [
        {
          _id: 'morgan-fixture',
          fname: 'Morgan',
          lname: 'Fixture',
          primaryDepartment: 'Synthetic Imaging Department',
        },
        {
          _id: 'ari-fixture',
          fname: 'Ari',
          lname: 'Fixture',
          primaryDepartment: 'Synthetic Environmental Methods',
        },
      ],
    );

    expect(userId).toBe('ari-fixture');
  });

  it('uses first-initial plus surname URL slugs when surname alone is ambiguous', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Blair Beacon Lab',
        url: 'https://medicine.yale.edu/lab/b-beacon/',
        slug: 'ysm-b-beacon',
      },
      [
        {
          _id: 'blair-beacon',
          fname: 'Blair',
          lname: 'Beacon',
          primaryDepartment: 'Synthetic Vision Department',
        },
        {
          _id: 'drew-beacon',
          fname: 'Drew',
          lname: 'Beacon',
          primaryDepartment: 'Synthetic Neuro Department',
        },
      ],
    );

    expect(userId).toBe('blair-beacon');
  });

  it('refuses ambiguous first-initial URL slug matches', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Quill Lab',
        url: 'https://medicine.yale.edu/lab/q-quill/',
        slug: 'ysm-q-quill',
      },
      [
        {
          _id: 'quinn-quill',
          fname: 'Quinn',
          lname: 'Quill',
        },
        {
          _id: 'quincy-quill',
          fname: 'Quincy',
          lname: 'Quill',
        },
      ],
    );

    expect(userId).toBeNull();
  });

  it('uses principal investigator profile contact evidence from the lab page', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Data Pattern Lab',
        url: 'https://medicine.yale.edu/lab/data-pattern/',
        slug: 'ysm-data-pattern',
        principalInvestigators: [
          {
            fullName: 'Arya Synthetic',
            profileUrl: 'https://medicine.yale.edu/lab/data-pattern/profile/arya-synthetic/',
            email: 'arya.synthetic@example.test',
          },
        ],
      },
      [
        {
          _id: 'arya-synthetic',
          fname: 'Arya',
          lname: 'Synthetic',
          primaryDepartment: 'Synthetic Emergency Methods',
          email: 'arya.synthetic@example.test',
        },
        {
          _id: 'other-pattern',
          fname: 'Other',
          lname: 'Pattern',
          primaryDepartment: 'Synthetic Biostatistics',
          email: 'other.pattern@example.test',
        },
      ],
    );

    expect(userId).toBe('arya-synthetic');
  });

  it('refuses ambiguous principal investigator profile evidence', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Aster Lab',
        url: 'https://medicine.yale.edu/lab/aster/',
        slug: 'ysm-aster',
        principalInvestigators: [
          {
            fullName: 'Faye Middle Aster',
            profileUrl: 'https://medicine.yale.edu/lab/aster/profile/faye-aster/',
          },
        ],
      },
      [
        {
          _id: 'faye-aster',
          fname: 'Faye',
          lname: 'Aster',
          primaryDepartment: 'Synthetic Cardiology',
        },
        {
          _id: 'jules-aster',
          fname: 'Jules',
          lname: 'Aster',
          primaryDepartment: 'Synthetic Cardiology',
        },
      ],
    );

    expect(userId).toBeNull();
  });

  it('does not fall back to surname heuristics when explicit PI profiles do not match candidates', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Orbit Lab',
        url: 'https://medicine.yale.edu/lab/orbit/',
        slug: 'ysm-orbit',
        principalInvestigators: [
          {
            fullName: 'Rowan Orbit',
            profileUrl: 'https://medicine.yale.edu/lab/orbit/profile/rowan-orbit/',
            email: 'rowan.orbit@example.test',
          },
        ],
      },
      [
        {
          _id: 'sage-orbit',
          fname: 'Sage',
          lname: 'Orbit',
          primaryDepartment: 'Synthetic Internal Medicine',
          email: 'sage.orbit@example.test',
        },
      ],
    );

    expect(userId).toBeNull();
  });

  it('matches explicit PI profile evidence even when the user is not faculty-classified yet', () => {
    const userId = findPiUserIdForLabFromCandidates(
      {
        name: 'Orbit Lab',
        url: 'https://medicine.yale.edu/lab/orbit/',
        slug: 'ysm-orbit',
        principalInvestigators: [
          {
            fullName: 'Rowan Orbit',
            profileUrl: 'https://medicine.yale.edu/lab/orbit/profile/rowan-orbit/',
            email: 'rowan.orbit@example.test',
          },
        ],
      },
      [
        {
          _id: 'rowan-orbit',
          fname: 'Rowan',
          lname: 'Orbit',
          primaryDepartment: 'Synthetic Ecology',
          email: 'rowan.orbit@example.test',
        },
        {
          _id: 'sage-orbit',
          fname: 'Sage',
          lname: 'Orbit',
          primaryDepartment: 'Synthetic Internal Medicine',
          email: 'sage.orbit@example.test',
        },
      ],
    );

    expect(userId).toBe('rowan-orbit');
  });

  it('returns all clean principal investigator profile matches', () => {
    const userIds = findPiUserIdsForLabFromCandidates(
      {
        name: 'Digital Methods Lab',
        url: 'https://medicine.yale.edu/lab/digital-methods/',
        slug: 'ysm-digital-methods',
        principalInvestigators: [
          {
            fullName: 'Lina Fixture',
            profileUrl: 'https://medicine.yale.edu/lab/digital-methods/profile/lina-fixture/',
            email: 'lina.fixture@example.test',
          },
          {
            fullName: 'Kira Dataset',
            profileUrl: 'https://medicine.yale.edu/lab/digital-methods/profile/kira-dataset/',
            email: 'kira.dataset@example.test',
          },
        ],
      },
      [
        {
          _id: 'lina-fixture',
          fname: 'Lina',
          lname: 'Fixture',
          email: 'lina.fixture@example.test',
        },
        {
          _id: 'kira-dataset',
          fname: 'Kira',
          lname: 'Dataset',
          email: 'kira.dataset@example.test',
        },
      ],
    );

    expect(userIds).toEqual(['lina-fixture', 'kira-dataset']);
  });
});

describe('piProfileUserObservationsFromProfiles', () => {
  it('emits official profile URL observations for matched PI users', () => {
    const observations = piProfileUserObservationsFromProfiles(
      [
        {
          fullName: 'Ari Fixture',
          profileUrl: 'https://medicine.yale.edu/lab/arifixture/profile/ari-fixture/',
          email: 'ari.fixture@example.test',
        },
      ],
      [
        {
          _id: 'ari-fixture',
          netid: 'fixturepi001',
          fname: 'Ari',
          lname: 'Fixture',
          email: 'ari.fixture@example.test',
          profileUrls: {
            personal: 'https://profiles.example.test/ari-fixture',
          },
        },
      ],
      'https://medicine.yale.edu/lab/arifixture/',
    );

    expect(observations).toEqual([
      {
        entityType: 'user',
        entityKey: 'netid:fixturepi001',
        field: 'profileUrls',
        value: {
          personal: 'https://profiles.example.test/ari-fixture',
          official: 'https://medicine.yale.edu/lab/arifixture/profile/ari-fixture/',
        },
        sourceUrl: 'https://medicine.yale.edu/lab/arifixture/',
        confidenceOverride: 0.75,
      },
    ]);
  });

  it('does not re-emit a profile URL already stored on the matched user', () => {
    const observations = piProfileUserObservationsFromProfiles(
      [
        {
          fullName: 'Ari Fixture',
          profileUrl: 'https://medicine.yale.edu/lab/arifixture/profile/ari-fixture/',
          email: 'ari.fixture@example.test',
        },
      ],
      [
        {
          _id: 'ari-fixture',
          netid: 'fixturepi001',
          fname: 'Ari',
          lname: 'Fixture',
          email: 'ari.fixture@example.test',
          profileUrls: {
            official: 'https://medicine.yale.edu/lab/arifixture/profile/ari-fixture/',
          },
        },
      ],
      'https://medicine.yale.edu/lab/arifixture/',
    );

    expect(observations).toEqual([]);
  });

  it('merges multiple same-user YSM profile URLs into one non-conflicting observation', () => {
    const observations = mergeUserProfileUrlObservations([
      {
        entityType: 'user',
        entityKey: 'netid:fixturepi202',
        field: 'profileUrls',
        value: {
          official: 'https://medicine.yale.edu/lab/fixture/profile/lina-fixture/',
        },
        sourceUrl: 'https://medicine.yale.edu/lab/fixture/',
        confidenceOverride: 0.75,
      },
      {
        entityType: 'user',
        entityKey: 'netid:fixturepi202',
        field: 'profileUrls',
        value: {
          official: 'https://medicine.yale.edu/lab/digital-methods/profile/lina-fixture/',
        },
        sourceUrl: 'https://medicine.yale.edu/lab/digital-methods/',
        confidenceOverride: 0.75,
      },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      entityType: 'user',
      entityKey: 'netid:fixturepi202',
      field: 'profileUrls',
      value: {
        official: 'https://medicine.yale.edu/lab/fixture/profile/lina-fixture/',
        ysmOfficial: 'https://medicine.yale.edu/lab/digital-methods/profile/lina-fixture/',
      },
    });
  });
});

describe('labToObservations', () => {
  it('does not emit index-only undergraduate access claims', () => {
    const obs = labToObservations(
      {
        name: 'Northstar Lab',
        url: 'https://medicine.yale.edu/lab/northstar/',
        slug: 'ysm-northstar',
      },
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    );

    expect(obs.map((o) => o.field)).not.toContain('acceptingUndergrads');
  });

  it('emits departments parsed from the lab page breadcrumbs', () => {
    const obs = labToObservations(
      {
        name: 'Northstar Lab',
        url: 'https://medicine.yale.edu/lab/northstar/',
        slug: 'ysm-northstar',
        departments: ['Synthetic Neuroscience', 'Yale School of Medicine'],
      },
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    );

    expect(obs.find((o) => o.field === 'departments')?.value).toEqual([
      'Synthetic Neuroscience',
      'Yale School of Medicine',
    ]);
  });
});

describe('parsePrincipalInvestigatorProfilesFromLabHtml', () => {
  it('extracts profile contact widgets titled principal investigator', () => {
    const html = `
      <script id="page-data" type="application/json">
        {&quot;sidebarComponents&quot;:[{&quot;key&quot;:&quot;ProfileContactWidget&quot;,&quot;model&quot;:{&quot;title&quot;:&quot;Principal Investigator&quot;,&quot;profile&quot;:{&quot;fullName&quot;:&quot;Arya Synthetic&quot;,&quot;profileUrl&quot;:&quot;/lab/data-pattern/profile/arya-synthetic/&quot;,&quot;generalContacts&quot;:{&quot;email&quot;:&quot;arya.synthetic@example.test&quot;}}}}]}
      </script>
    `;

    expect(parsePrincipalInvestigatorProfilesFromLabHtml(html, 'https://medicine.yale.edu/lab/data-pattern/')).toEqual([
      {
        fullName: 'Arya Synthetic',
        profileUrl: 'https://medicine.yale.edu/lab/data-pattern/profile/arya-synthetic/',
        email: 'arya.synthetic@example.test',
      },
    ]);
  });

  it('extracts leadership profile cards from YSM team-page data', () => {
    const html = `
      <script id="page-data" type="application/json">
        {
          "mainComponents": [
            {
              "key": "ProfileGrid",
              "model": {
                "profiles": {
                  "collection": [
                    {
                      "name": "Ari Fixture",
                      "profileUrl": "/lab/arifixture/profile/ari-fixture/",
                      "isLeadership": true,
                      "contacts": { "email": "ari.fixture@example.test" }
                    },
                    {
                      "name": "Student Member",
                      "profileUrl": "/lab/arifixture/profile/student-member/",
                      "isLeadership": false,
                      "contacts": { "email": "student.member@example.test" }
                    }
                  ]
                }
              }
            }
          ]
        }
      </script>
    `;

    expect(
      parsePrincipalInvestigatorProfilesFromLabHtml(
        html,
        'https://medicine.yale.edu/lab/arifixture/team/',
      ),
    ).toEqual([
      {
        fullName: 'Ari Fixture',
        profileUrl: 'https://medicine.yale.edu/lab/arifixture/profile/ari-fixture/',
        email: 'ari.fixture@example.test',
      },
    ]);
  });

  it('uses a single official profile contact widget when no explicit PI title exists', () => {
    const html = `
      <script id="page-data" type="application/json">
        {&quot;sidebarComponents&quot;:[{&quot;key&quot;:&quot;ProfileContactWidget&quot;,&quot;model&quot;:{&quot;title&quot;:&quot;Morgan Fixture, MD&quot;,&quot;profile&quot;:{&quot;fullName&quot;:&quot;Morgan Fixture&quot;,&quot;profileUrl&quot;:&quot;https://medicine.yale.edu/profile/morgan-fixture/&quot;,&quot;generalContacts&quot;:{&quot;email&quot;:&quot;morgan.fixture@example.test&quot;}}}}]}
      </script>
    `;

    expect(parsePrincipalInvestigatorProfilesFromLabHtml(html, 'https://medicine.yale.edu/lab/fixture-profile/')).toEqual([
      {
        fullName: 'Morgan Fixture',
        profileUrl: 'https://medicine.yale.edu/profile/morgan-fixture/',
        email: 'morgan.fixture@example.test',
      },
    ]);
  });

  it('extracts multiple co-director profile widgets as source-backed lab leadership', () => {
    const html = `
      <script id="page-data" type="application/json">
        {&quot;sidebarComponents&quot;:[{&quot;key&quot;:&quot;ProfileContactWidget&quot;,&quot;model&quot;:{&quot;title&quot;:&quot;Co-Director&quot;,&quot;profile&quot;:{&quot;fullName&quot;:&quot;Lina Fixture&quot;,&quot;profileUrl&quot;:&quot;/lab/digital-methods/profile/lina-fixture/&quot;,&quot;generalContacts&quot;:{&quot;email&quot;:&quot;lina.fixture@example.test&quot;}}}},{&quot;key&quot;:&quot;ProfileContactWidget&quot;,&quot;model&quot;:{&quot;title&quot;:&quot;Co-Director&quot;,&quot;profile&quot;:{&quot;fullName&quot;:&quot;Kira Dataset&quot;,&quot;profileUrl&quot;:&quot;/lab/digital-methods/profile/kira-dataset/&quot;,&quot;generalContacts&quot;:{&quot;email&quot;:&quot;kira.dataset@example.test&quot;}}}}]}
      </script>
    `;

    expect(parsePrincipalInvestigatorProfilesFromLabHtml(html, 'https://medicine.yale.edu/lab/digital-methods/')).toEqual([
      {
        fullName: 'Lina Fixture',
        profileUrl: 'https://medicine.yale.edu/lab/digital-methods/profile/lina-fixture/',
        email: 'lina.fixture@example.test',
      },
      {
        fullName: 'Kira Dataset',
        profileUrl: 'https://medicine.yale.edu/lab/digital-methods/profile/kira-dataset/',
        email: 'kira.dataset@example.test',
      },
    ]);
  });

  it('extracts principal investigator profiles from YSM member-listing sections', () => {
    const html = `
      <section class="organization-member-listing" aria-label="Principal Investigator">
        <h2>Principal Investigator</h2>
        <article class="profile-grid-item" aria-label="Lio Fixture's Profile">
          <a href="/lab/member-list/profile/lio-fixture/">View Profile</a>
        </article>
      </section>
    `;

    expect(parsePrincipalInvestigatorProfilesFromLabHtml(html, 'https://medicine.yale.edu/lab/member-list/')).toEqual([
      {
        fullName: 'Lio Fixture',
        profileUrl: 'https://medicine.yale.edu/lab/member-list/profile/lio-fixture/',
      },
    ]);
  });
});
