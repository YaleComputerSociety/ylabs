import { describe, expect, it } from 'vitest';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import {
  cleanResearchPassage,
  joinResearchPassages,
  MAX_RESEARCH_TEXT_CHARS,
  readKeywordListItems,
  readLabPage,
  readLabPageName,
  readLabPageResearchPassages,
  readLabPageTopics,
  topicScanText,
} from '../utils/labPageResearchRead';

const PAGE = 'https://example.org/lab/quillfeather/';

const canonicalizer = createResearchAreaCanonicalizer(
  buildResearchAreaResolverIndex([
    { name: 'Membrane Biology' },
    { name: 'Structural Biology' },
    { name: 'Glacier Hydrology' },
    { name: 'Oncology' },
  ]),
);

const LAB_HOME = `
<html>
  <head>
    <title>Quillfeather Lab | Department of Imaginary Sciences</title>
    <meta property="og:site_name" content="Quillfeather Lab" />
    <meta name="description" content="The Quillfeather Lab studies how glacier meltwater reshapes membrane biology in alpine microbes." />
  </head>
  <body>
    <nav><a href="/">Home</a><a href="/people">People</a><p>Navigation paragraph that is long enough to be a passage but sits in the nav.</p></nav>
    <main>
      <h1>Quillfeather Lab</h1>
      <h2>Research</h2>
      <p>We study how glacier meltwater reshapes membrane biology in alpine microbes, combining field sampling with structural biology.</p>
      <p>Our current projects ask how lipid packing changes when meltwater chemistry shifts during the thaw season.</p>
      <h2>Methods</h2>
      <ul>
        <li>Cryo-electron tomography</li>
        <li>Lipidomics</li>
        <li>Analyzes</li>
      </ul>
      <h2>News</h2>
      <div class="publication-list"><p>Venn O, Marrow T. Lipid packing in meltwater microbes. J Imag Sci. 2024;12:1-9.</p></div>
      <div class="profile-disclaimer"><p>Adjunct members typically hold an appointment at another institution and collaborate with the lab.</p></div>
    </main>
    <footer><p>Copyright notice for the imaginary department that is long enough to count as text.</p></footer>
  </body>
</html>`;

describe('readLabPageName', () => {
  it('reads the stated name from og:site_name before the title', () => {
    expect(
      readLabPageName(LAB_HOME, { pageUrl: PAGE, kind: 'organization', entityType: 'LAB' }),
    ).toEqual({
      value: 'Quillfeather Lab',
      from: 'og:site_name',
      declaresLaboratory: true,
      leadsPersonalPage: false,
    });
  });

  it('keeps the fullest form of the stated name a heading repeats', () => {
    const html =
      '<html><head><meta property="og:site_name" content="Venn Lab" /><title>Venn Lab</title></head><body><h1>Orla Venn Lab for Tidal Archive Research</h1></body></html>';
    expect(
      readLabPageName(html, { pageUrl: PAGE, kind: 'organization', entityType: 'LAB' })?.value,
    ).toBe('Orla Venn Lab for Tidal Archive Research');
  });

  it('skips an institutional host segment and takes the unit segment of the title', () => {
    const html =
      '<html><head><title>Yale School of Imagination | Center for Tidal Archives</title></head><body></body></html>';
    expect(
      readLabPageName(html, { pageUrl: PAGE, kind: 'organization', entityType: 'CENTER' })?.value,
    ).toBe('Center for Tidal Archives');
  });

  it('refuses an umbrella organization as the name of a person-scoped row', () => {
    const html =
      '<html><head><title>Center for Tidal Archives</title></head><body><h1>Center for Tidal Archives</h1></body></html>';
    expect(
      readLabPageName(html, {
        pageUrl: PAGE,
        kind: 'person',
        entityType: 'FACULTY_RESEARCH_AREA',
        entityKey: 'orla-venn-faculty-research',
      }),
    ).toBeUndefined();
  });

  it("refuses another known person's lab on a person-scoped row", () => {
    const html =
      '<html><head><title>Tobin Marrow Lab</title></head><body><h1>Tobin Marrow Lab</h1></body></html>';
    expect(
      readLabPageName(html, {
        pageUrl: 'https://example.org/lab/tmarrow/',
        kind: 'person',
        entityType: 'FACULTY_RESEARCH_AREA',
        entityKey: 'orla-venn-faculty-research',
        personName: 'Orla Venn',
        knownPersonSurnames: new Set(['marrow', 'venn']),
      }),
    ).toBeUndefined();
  });

  it("keeps the person's own lab on a person-scoped row", () => {
    const html = '<html><head><title>Venn Lab</title></head><body><h1>Venn Lab</h1></body></html>';
    expect(
      readLabPageName(html, {
        pageUrl: 'https://example.org/lab/venn/',
        kind: 'person',
        entityType: 'FACULTY_RESEARCH_AREA',
        entityKey: 'orla-venn-faculty-research',
        personName: 'Orla Venn',
        knownPersonSurnames: new Set(['marrow', 'venn']),
      })?.value,
    ).toBe('Venn Lab');
  });

  it("marks a LAB row's site titled only with its lead's name as a personal page", () => {
    const html =
      '<html><head><title>Orla Venn | Home</title><meta property="og:site_name" content="Orla Venn" /></head><body></body></html>';
    expect(
      readLabPageName(html, {
        pageUrl: PAGE,
        kind: 'organization',
        entityType: 'LAB',
        personName: 'Orla Venn',
      }),
    ).toEqual({
      value: 'Orla Venn',
      from: 'og:site_name',
      declaresLaboratory: false,
      leadsPersonalPage: true,
    });
  });

  it('names nothing from a person profile page', () => {
    const html =
      '<html><head><title>Orla Venn, PhD | Example School</title></head><body><h1>Venn Lab</h1></body></html>';
    expect(
      readLabPageName(html, {
        pageUrl: 'https://medicine.yale.edu/profile/orla-venn/',
        kind: 'organization',
        entityType: 'LAB',
        personName: 'Orla Venn',
      }),
    ).toBeUndefined();
  });

  it('names nothing when the page states no organizational name', () => {
    const html =
      '<html><head><title>Publications</title></head><body><h1>Publications</h1></body></html>';
    expect(readLabPageName(html, { pageUrl: PAGE, kind: 'organization', entityType: 'LAB' })).toBe(
      undefined,
    );
  });
});

describe('readLabPageResearchPassages', () => {
  it('reads the research section and drops navigation, footer, publication and disclaimer text', () => {
    const passages = readLabPageResearchPassages(LAB_HOME, { pageUrl: PAGE, entityType: 'LAB' });
    const texts = passages.map((passage) => passage.text);
    expect(texts[0]).toMatch(/^We study how glacier meltwater reshapes membrane biology/);
    expect(passages[0]).toMatchObject({ origin: 'research-section', heading: 'Research' });
    expect(texts.some((text) => /lipid packing changes/.test(text))).toBe(true);
    expect(texts.some((text) => /Navigation paragraph/.test(text))).toBe(false);
    expect(texts.some((text) => /Copyright notice/.test(text))).toBe(false);
    expect(texts.some((text) => /J Imag Sci/.test(text))).toBe(false);
    expect(texts.some((text) => /Adjunct members/.test(text))).toBe(false);
  });

  it('keeps the meta description once and does not repeat a passage it already holds', () => {
    const passages = readLabPageResearchPassages(LAB_HOME, { pageUrl: PAGE, entityType: 'LAB' });
    const meta = passages.filter((passage) => passage.origin === 'meta-description');
    expect(meta).toHaveLength(1);
    const keys = passages.map((passage) => passage.text.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reads a biography held in a div under its heading and drops the career sentences', () => {
    const html = `
      <html><body><main>
        <section>
          <h3>Biography</h3>
          <div class="bio">Orla Venn received her PhD in Imaginary Sciences from Example University in 2004. Her research examines how tidal archives record coastal erosion over centuries.</div>
        </section>
      </main></body></html>`;
    const passages = readLabPageResearchPassages(html, {
      pageUrl: PAGE,
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(passages.map((passage) => passage.text)).toContain(
      'Her research examines how tidal archives record coastal erosion over centuries.',
    );
    expect(passages.some((passage) => /received her PhD/.test(passage.text))).toBe(false);
  });

  it('falls back to the page body when the main landmark is an empty wrapper', () => {
    const html = `
      <html><body>
        <div role="main"></div>
        <div class="section"><p>I work on the formal theory of committee bargaining and how agenda rules shape the outcomes legislatures reach.</p></div>
      </body></html>`;
    expect(
      readLabPageResearchPassages(html, { pageUrl: PAGE, entityType: 'FACULTY_RESEARCH_AREA' }).map(
        (passage) => passage.text,
      ),
    ).toEqual([
      'I work on the formal theory of committee bargaining and how agenda rules shape the outcomes legislatures reach.',
    ]);
  });

  it('keeps a list under a research heading as one passage and drops a link-only list', () => {
    const html = `
      <html><body><main>
        <h2>Research Areas</h2>
        <ul>
          <li>Sediment transport in braided rivers</li>
          <li>Ice-shelf calving under warming oceans</li>
        </ul>
        <h2>Research Projects</h2>
        <ul>
          <li><a href="/a">Project Alder</a></li>
          <li><a href="/b">Project Birch</a></li>
        </ul>
      </main></body></html>`;
    expect(
      readLabPageResearchPassages(html, { pageUrl: PAGE, entityType: 'LAB' }).map(
        (passage) => passage.text,
      ),
    ).toEqual(['Sediment transport in braided rivers; Ice-shelf calving under warming oceans']);
  });

  it('joins a paragraph that introduces a list to the list it introduces', () => {
    const html = `
      <html><body><main>
        <p>To reach this goal, the group's research has focused on:</p>
        <ul>
          <li>Mapping how sea ice thins along the shelf edge</li>
          <li>Measuring meltwater pulses beneath floating ice</li>
        </ul>
      </main></body></html>`;
    expect(
      readLabPageResearchPassages(html, { pageUrl: PAGE, entityType: 'LAB' }).map(
        (passage) => passage.text,
      ),
    ).toContain(
      "To reach this goal, the group's research has focused on: Mapping how sea ice thins along the shelf edge; Measuring meltwater pulses beneath floating ice",
    );
  });

  it('reads a structured-data description', () => {
    const html = `
      <html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'ProfilePage',
        mainEntity: {
          '@type': 'Person',
          description:
            'Her research follows how drifting kelp forests carry nutrients between offshore islands.',
        },
      })}</script></head><body></body></html>`;
    expect(readLabPageResearchPassages(html, { pageUrl: PAGE })).toEqual([
      {
        origin: 'structured-data',
        text: 'Her research follows how drifting kelp forests carry nutrients between offshore islands.',
      },
    ]);
  });
});

describe('cleanResearchPassage', () => {
  it('refuses a title that states no sentence', () => {
    expect(
      cleanResearchPassage('Lipid packing in meltwater microbes across three alpine catchments'),
    ).toBe('');
  });

  it('refuses a patient call to action and keeps the research sentence beside it', () => {
    expect(
      cleanResearchPassage(
        "Are you a patient? View this doctor's clinical profile on the clinic website. Her research measures how fasting changes kidney filtration in older adults.",
      ),
    ).toBe('Her research measures how fasting changes kidney filtration in older adults.');
  });

  it('redacts a direct email address', () => {
    expect(
      cleanResearchPassage(
        'We study how meltwater chemistry shapes microbial membranes; write to orla.venn@example.org for samples.',
      ),
    ).not.toMatch(/orla\.venn@example\.org/);
  });
});

describe('joinResearchPassages', () => {
  it('stops before the research text would pass its cap', () => {
    const long = 'A'.repeat(MAX_RESEARCH_TEXT_CHARS - 10);
    const joined = joinResearchPassages([
      { origin: 'main-content', text: long },
      { origin: 'main-content', text: 'This passage would pass the cap.' },
    ]);
    expect(joined).toBe(long);
  });
});

describe('readLabPageTopics', () => {
  it('matches approved terms in the research text and keeps a labelled keyword list', () => {
    const html = `
      <html><body>
        <section><h4>Medical Research Interests</h4><div>Alpine Microbes; Meltwater Chemistry</div></section>
      </body></html>`;
    const topics = readLabPageTopics(
      html,
      'We study membrane biology and glacier hydrology in alpine microbes.',
      canonicalizer,
    );
    expect(topics).toEqual([
      'Alpine Microbes',
      'Meltwater Chemistry',
      'Membrane Biology',
      'Glacier Hydrology',
    ]);
  });

  it("drops a division-level label and the row's own department", () => {
    const topics = readLabPageTopics(
      '<html><body></body></html>',
      'Our group works on oncology, glacier hydrology, membrane biology and structural biology.',
      canonicalizer,
      ['Structural Biology'],
    );
    expect(topics).toEqual(['Membrane Biology', 'Glacier Hydrology']);
  });

  it('matches no topic from a journal, an address, a training line, a role or an organization name', () => {
    const text = [
      'She is a statistical reviewer for the Journal of Glacier Hydrology.',
      'Office: 12 Quarry Street, Example City, CT 06511.',
      'He received his PhD in Membrane Biology from Example University.',
      'She serves as director of the Glacier Hydrology core.',
      'He is affiliated with the Example Center for Glacier Hydrology and teaches there.',
      'Our lab studies membrane biology and structural biology in alpine microbes.',
    ].join(' ');
    expect(topicScanText(text)).toMatch(/Our lab studies membrane biology/);
    const topics = readLabPageTopics('<html><body></body></html>', text, canonicalizer);
    expect([...topics].sort()).toEqual(['Membrane Biology', 'Structural Biology']);
  });

  it('states no list from a single unlabelled mention', () => {
    expect(
      readLabPageTopics(
        '<html><body></body></html>',
        'The technique was first popular in glacier hydrology before we adapted it.',
        canonicalizer,
      ),
    ).toEqual([]);
  });

  it('reads a keyword list only under a keyword heading', () => {
    expect(
      readKeywordListItems(
        '<html><body><h3>Research Keywords</h3><p>Tidal Archives; Coastal Erosion</p><h3>Contact</h3><p>Room 12; Building 4</p></body></html>',
      ),
    ).toEqual(['Tidal Archives', 'Coastal Erosion']);
  });
});

describe('readLabPage', () => {
  it('reads every field from one page and is a function of the page alone', () => {
    const context = { pageUrl: PAGE, kind: 'organization' as const, entityType: 'LAB' };
    const first = readLabPage(LAB_HOME, context, canonicalizer);
    const second = readLabPage(LAB_HOME, context, canonicalizer);
    expect(second).toEqual(first);
    expect(first.name?.value).toBe('Quillfeather Lab');
    expect(first.researchText).toMatch(/glacier meltwater reshapes membrane biology/);
    expect(first.topics).toEqual(
      expect.arrayContaining(['Membrane Biology', 'Structural Biology']),
    );
    expect(first).not.toHaveProperty('methods');
  });

  it('returns an empty read for an empty page', () => {
    expect(
      readLabPage('', { pageUrl: PAGE, kind: 'organization', entityType: 'LAB' }, canonicalizer),
    ).toEqual({
      name: undefined,
      passages: [],
      researchText: '',
      topics: [],
    });
  });
});
