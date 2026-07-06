import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import * as cheerio from 'cheerio';
import {
  YsmAtoZScraper,
  extractLabHomepageDescription,
  extractProfileContactWidgetProfile,
  extractResearchFacultyUrl,
  extractSoleResearchFacultyProfile,
  inferPiNameFromLabName,
  labResearchFacultyToObservations,
  labToObservations,
} from '../sources/ysmAtoZScraper';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const SAMPLE_HTML = `
<html><body>
<table>
  <tbody>
    <tr><td><a href="https://medicine.yale.edu/lab/3d-tumor-lab/">3D Tumor Lab</a></td><td>https://medicine.yale.edu/lab/3d-tumor-lab/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/abujarad/">Abujarad's Digital Health Lab</a></td><td>https://medicine.yale.edu/lab/abujarad/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/arnsten/">Arnsten Lab</a></td><td>https://medicine.yale.edu/lab/arnsten/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/zhang/">Zhang Laboratory of Single-Molecule Biophysics</a></td><td>https://medicine.yale.edu/lab/zhang/</td></tr>
    <tr><td><a href="">Empty URL Lab</a></td><td></td></tr>
    <tr><td>No Link Lab</td><td>not a url</td></tr>
  </tbody>
</table>
</body></html>
`;

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'ysm-atoz-index',
    sourceWeight: 0.8,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('YsmAtoZScraper runtime bounds', () => {
  it('rejects unsafe runtime offsets before fetching the index page', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: '<html><body><table></table></body></html>' });
    const scraper = new YsmAtoZScraper();
    const { ctx } = makeContext();
    ctx.options.offset = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--offset must be a safe non-negative integer/);

    expect(axios.get).not.toHaveBeenCalled();
  });

  it('rejects unsafe runtime limits before fetching the index page', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: '<html><body><table></table></body></html>' });
    const scraper = new YsmAtoZScraper();
    const { ctx } = makeContext();
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(axios.get).not.toHaveBeenCalled();
  });
});

function parseLabsForTest(html: string) {
  const $ = cheerio.load(html);
  const labs: Array<{ name: string; url: string }> = [];
  $('table tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 1) return;
    const linkEl = cells.eq(0).find('a').first();
    const name = linkEl.text().trim() || cells.eq(0).text().trim();
    const url = linkEl.attr('href') || '';
    if (!name || !url || !/^https?:\/\//i.test(url)) return;
    labs.push({ name, url });
  });
  return labs;
}

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
    if (/^[A-Z][a-zA-Z-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  return tokens[0] && /^[A-Z][a-zA-Z-]+$/.test(tokens[0]) ? tokens[0] : null;
}

describe('YsmAtoZ HTML parsing', () => {
  it('extracts only rows with a valid URL and name', () => {
    const labs = parseLabsForTest(SAMPLE_HTML);
    expect(labs).toHaveLength(4);
    expect(labs.map((l) => l.name)).toEqual([
      '3D Tumor Lab',
      "Abujarad's Digital Health Lab",
      'Arnsten Lab',
      'Zhang Laboratory of Single-Molecule Biophysics',
    ]);
  });

  it('skips rows with empty URLs or non-URL second columns', () => {
    const labs = parseLabsForTest(SAMPLE_HTML);
    expect(labs.find((l) => l.name === 'Empty URL Lab')).toBeUndefined();
    expect(labs.find((l) => l.name === 'No Link Lab')).toBeUndefined();
  });
});

describe('slugifyFromUrl', () => {
  it('extracts the path segment after /lab/ as the slug seed', () => {
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/arnsten/')).toBe('ysm-arnsten');
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/3d-tumor-lab/')).toBe('ysm-3d-tumor-lab');
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
    expect(inferPiSurname('Arnsten Lab')).toBe('Arnsten');
    expect(inferPiSurname('Iwasaki Lab')).toBe('Iwasaki');
  });

  it("strips possessive apostrophe-s", () => {
    expect(inferPiSurname("Abujarad's Digital Health Lab")).toBeTruthy();
  });

  it('extracts surname before "Laboratory"', () => {
    expect(inferPiSurname('Zhang Laboratory of Single-Molecule Biophysics')).toBe('Zhang');
  });

  it('returns null for descriptive-only names', () => {
    expect(inferPiSurname('3D Tumor Lab')).not.toBe('3D');
  });
});

describe('inferPiNameFromLabName', () => {
  it('keeps first-name context for labs named after a full PI name', () => {
    expect(inferPiNameFromLabName('Ya-Chi Ho Lab')).toEqual({
      firstName: 'Ya-Chi',
      lastName: 'Ho',
    });
  });

  it('falls back to surname-only context for surname lab names', () => {
    expect(inferPiNameFromLabName('Arnsten Lab')).toEqual({
      firstName: '',
      lastName: 'Arnsten',
    });
  });
});

describe('labToObservations', () => {
  it('does not emit index-only undergraduate access claims', () => {
    const obs = labToObservations(
      {
        name: 'Arnsten Lab',
        url: 'https://medicine.yale.edu/lab/arnsten/',
        slug: 'ysm-arnsten',
      },
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    );

    expect(obs.map((o) => o.field)).not.toContain('acceptingUndergrads');
  });
});

describe('extractLabHomepageDescription', () => {
  it('prefers official GenericContent metadata over truncated meta tags', () => {
    const officialDescription =
      'The primary goal of the Ho Lab is to investigate the impact of viral pathogenesis on human health. We investigate viral pathogenesis in the context of genomics, pathophysiology, immunology, and treatment. Specifically, we are interested in how chronic viral infection disrupts host homeostasis and causes chronic diseases, including chronic inflammation and cancer. Our approach involves using advanced molecular biology, genomics, immunology, single-cell multi-omics, spatial transcriptomics, bioinformatics tools on clinical samples and animal models.';
    const pageData = {
      mainComponents: [
        {
          key: 'GenericContent',
          model: {
            metaData: {
              description: officialDescription,
            },
            paragraphs: [
              {
                text: `<p>${officialDescription}</p>`,
              },
            ],
          },
        },
      ],
    };
    const escapedJson = JSON.stringify(pageData).replace(/"/g, '&quot;');
    const html = `
      <html>
        <head>
          <meta name="description" content="The primary goal of the Ho Lab is truncated," />
        </head>
        <body>
          <script>${escapedJson}</script>
        </body>
      </html>
    `;

    expect(extractLabHomepageDescription(html)).toEqual({
      description: officialDescription,
      shortDescription:
        'Specifically, we are interested in how chronic viral infection disrupts host homeostasis and causes chronic diseases, including chronic inflammation and cancer.',
    });
  });

  it('falls back to a sufficiently detailed OpenGraph description', () => {
    const description =
      'This lab studies mechanisms of infection, immunity, and treatment using clinical samples, animal models, genomics, single-cell methods, spatial transcriptomics, and bioinformatics tools.';

    expect(
      extractLabHomepageDescription(`
        <html>
          <head><meta property="og:description" content="${description}" /></head>
        </html>
      `),
    ).toMatchObject({
      description,
    });
  });
});

describe('extractResearchFacultyUrl', () => {
  it('finds the official Research Faculty page from lab navigation', () => {
    const html = `
      <html><body>
        <a href="/lab/radiology-informatics-and-image-processing/methods/">Methods</a>
        <a href="/lab/radiology-informatics-and-image-processing/research-faculty/">Research Faculty</a>
      </body></html>
    `;

    expect(
      extractResearchFacultyUrl(
        html,
        'https://medicine.yale.edu/lab/radiology-informatics-and-image-processing/',
      ),
    ).toBe(
      'https://medicine.yale.edu/lab/radiology-informatics-and-image-processing/research-faculty/',
    );
  });
});

describe('extractSoleResearchFacultyProfile', () => {
  it('extracts one profile card and ignores duplicate view-profile links', () => {
    const html = `
      <html><body>
        <a href="/profile/fixture-lab-director/">Christopher Whitlow, MD, PhD, MHA</a>
        <p>Chair, Department of Radiology and Biomedical Imaging</p>
        <a href="/profile/fixture-lab-director/">View Full Profile</a>
      </body></html>
    `;

    expect(
      extractSoleResearchFacultyProfile(
        html,
        'https://medicine.yale.edu/lab/radiology-informatics-and-image-processing/research-faculty/',
      ),
    ).toEqual({
      name: 'Christopher Whitlow, MD, PhD, MHA',
      profileUrl: 'https://medicine.yale.edu/profile/fixture-lab-director/',
      title: '',
    });
  });

  it('keeps title text from the profile card container when present', () => {
    const html = `
      <html><body>
        <ul>
          <li>
            <a href="profile/fixture-lab-director/">Christopher Whitlow, MD, PhD, MHA</a>
            Chair, Department of Radiology and Biomedical Imaging
            <a href="profile/fixture-lab-director/">View Full Profile</a>
          </li>
        </ul>
      </body></html>
    `;

    expect(
      extractSoleResearchFacultyProfile(
        html,
        'https://medicine.yale.edu/lab/radiology-informatics-and-image-processing/research-faculty/',
      ),
    ).toEqual({
      name: 'Christopher Whitlow, MD, PhD, MHA',
      profileUrl: 'https://medicine.yale.edu/profile/fixture-lab-director/',
      title: 'Chair, Department of Radiology and Biomedical Imaging',
    });
  });

  it('returns null when a people page has multiple profile cards', () => {
    const html = `
      <html><body>
        <a href="/profile/one-person/">One Person</a>
        <a href="/profile/two-person/">Two Person</a>
      </body></html>
    `;

    expect(
      extractSoleResearchFacultyProfile(
        html,
        'https://medicine.yale.edu/lab/example/research-faculty/',
      ),
    ).toBeNull();
  });
});

describe('extractProfileContactWidgetProfile', () => {
  it('extracts a single official profile contact widget from lab page data', () => {
    const pageData = {
      sidebarComponents: [
        {
          key: 'ProfileContactWidget',
          model: {
            title: 'Garg Research Lab',
            profile: {
              fullName: 'Skylar Lab',
              title: 'Director, Yale Lupus Clinical Research Program, Internal Medicine',
              profileUrl: '/lab/garg/profile/skylar-lab/',
              generalContacts: {
                email: 'skylar.lab@yale.edu',
              },
            },
          },
        },
      ],
    };
    const html = `
      <html><body>
        <script id="page-data" type="application/json">${JSON.stringify(pageData).replace(/"/g, '&quot;')}</script>
      </body></html>
    `;

    expect(extractProfileContactWidgetProfile(html, 'https://medicine.yale.edu/lab/garg/')).toEqual({
      name: 'Skylar Lab',
      profileUrl: 'https://medicine.yale.edu/profile/skylar-lab/',
      title: 'Director, Yale Lupus Clinical Research Program, Internal Medicine',
      email: 'skylar.lab@yale.edu',
    });
  });

  it('does not infer a lead when multiple profile contact widgets are present', () => {
    const pageData = {
      sidebarComponents: [
        {
          key: 'ProfileContactWidget',
          model: {
            profile: {
              fullName: 'One Person',
              profileUrl: '/profile/one-person/',
            },
          },
        },
        {
          key: 'ProfileContactWidget',
          model: {
            profile: {
              fullName: 'Two Person',
              profileUrl: '/profile/two-person/',
            },
          },
        },
      ],
    };
    const html = `
      <html><body>
        <script id="page-data" type="application/json">${JSON.stringify(pageData).replace(/"/g, '&quot;')}</script>
      </body></html>
    `;

    expect(extractProfileContactWidgetProfile(html, 'https://medicine.yale.edu/lab/example/')).toBeNull();
  });
});

describe('labResearchFacultyToObservations', () => {
  const lab = {
    name: 'Garg Lupus Lab',
    url: 'https://medicine.yale.edu/lab/garg/',
    slug: 'ysm-garg',
  };

  it('emits official profile user identity and PI key observations for a person-specific widget email', () => {
    const observations = labResearchFacultyToObservations(
      lab,
      {
        name: 'Skylar Lab',
        profileUrl: 'https://medicine.yale.edu/profile/skylar-lab/',
        title: 'Director, Yale Lupus Clinical Research Program, Internal Medicine',
        email: 'skylar.lab@yale.edu',
      },
      lab.url,
    );

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchGroupMember',
          entityKey: 'ysm-garg:research-faculty:skylar-lab',
          field: 'profileUrl',
          value: 'https://medicine.yale.edu/profile/skylar-lab/',
        }),
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:skylar.lab',
          field: 'email',
          value: 'skylar.lab@yale.edu',
        }),
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:skylar.lab',
          field: 'profileUrls',
          value: {
            medicine: 'https://medicine.yale.edu/profile/skylar-lab/',
            official: 'https://medicine.yale.edu/profile/skylar-lab/',
          },
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'ysm-garg',
          field: 'inferredPiUserKey',
          value: 'netid:skylar.lab',
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'ysm-garg',
          field: 'contactName',
          value: 'Skylar Lab',
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'ysm-garg',
          field: 'contactEmail',
          value: 'skylar.lab@yale.edu',
        }),
      ]),
    );
  });

  it('does not create user or PI-key observations for a generic widget email', () => {
    const observations = labResearchFacultyToObservations(
      lab,
      {
        name: 'Skylar Lab',
        profileUrl: 'https://medicine.yale.edu/profile/skylar-lab/',
        title: 'Director, Yale Lupus Clinical Research Program, Internal Medicine',
        email: 'ysm.editor@yale.edu',
      },
      lab.url,
    );

    expect(observations.some((observation) => observation.entityType === 'user')).toBe(false);
    expect(observations.find((observation) => observation.field === 'inferredPiUserKey')).toBeUndefined();
  });
});
