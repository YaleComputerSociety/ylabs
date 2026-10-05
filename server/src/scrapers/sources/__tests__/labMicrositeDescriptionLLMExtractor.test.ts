import { describe, it, expect } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../../utils/researchHomeNameIdentityAuthority';
import {
  descriptionPageNamesRowLead,
  htmlToText,
  isRejectedDescriptionSourceUrl,
  usefulLabName,
  descriptionExtractionToObservations,
  discoverResearchSubPageUrls,
  researchSubPageCrawlUrls,
  researchSentencesOfBiographyBody,
} from '../labMicrositeDescriptionLLMExtractor';

describe('isRejectedDescriptionSourceUrl', () => {
  it('rejects the YSM A–Z index landing page so its boilerplate is never a lab description', () => {
    expect(
      isRejectedDescriptionSourceUrl('https://medicine.yale.edu/about/a-to-z-index/lab-websites/'),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl(
        'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
      ),
    ).toBe(true);
  });

  it('accepts a genuine per-lab microsite page', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/lab/chupp/')).toBe(false);
    expect(isRejectedDescriptionSourceUrl('https://zimmermanlab.yale.edu/')).toBe(false);
  });

  it('still rejects directory and non-descriptive source pages', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/people/')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://reporter.nih.gov/project-details/123')).toBe(
      true,
    );
    expect(isRejectedDescriptionSourceUrl('not-a-url')).toBe(true);
  });

  it('rejects a paginated listing page, whose pager evidence is in the query string (#2570)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://som.yale.edu/faculty-research/faculty-directory?page=1',
      ),
    ).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/labs/page/3')).toBe(true);
  });

  it('rejects a hyphenated multi-person index named by its own last path segment (#2570)', () => {
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/about/staff-directory')).toBe(
      true,
    );
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/people/faculty-roster')).toBe(
      true,
    );
  });

  it('still accepts a person page nested BENEATH a directory segment (#2570)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://som.yale.edu/faculty-research/faculty-directory/tamsin-q-wrenfield',
      ),
    ).toBe(false);
    expect(
      isRejectedDescriptionSourceUrl(
        'https://environment.yale.edu/directory/faculty/alder-m-hollowmere',
      ),
    ).toBe(false);
  });

  it('rejects a binary document, which this lane can only read as HTML (#1918)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://science.example.edu/sites/default/files/files/2025%20STARS2%20Symposium.pdf',
      ),
    ).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://www.cs.example.edu/homes/q/pubs/biog.pdf')).toBe(
      true,
    );
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/lab/overview.docx')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/lab/slides.pptx')).toBe(true);
  });

  it('keeps accepting a page whose path merely contains those letters', () => {
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/lab/pdf-viewer/')).toBe(false);
    expect(isRejectedDescriptionSourceUrl('https://example.yale.edu/research/xlsx-tools')).toBe(
      false,
    );
  });

  it('rejects a department-wide undergrad research opportunities hub page (#1716)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      ),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl(
        'https://mcdb.yale.edu/undergraduate/undergrad-degree-programs',
      ),
    ).toBe(true);
  });
});

describe('htmlToText block-boundary spacing for the LLM prompt (#1776)', () => {
  it('inserts a space between adjacent paragraphs instead of gluing them', () => {
    expect(
      htmlToText('<body><p>About David Simon.</p><p>His research focuses on genocide.</p></body>'),
    ).toBe('About David Simon. His research focuses on genocide.');
  });

  it('separates a section heading from the paragraph that follows it', () => {
    expect(htmlToText('<body><h2>About</h2><p>David Simon studies genocide.</p></body>')).toBe(
      'About David Simon studies genocide.',
    );
  });

  it('still strips script, style, nav, and footer chrome before flattening', () => {
    expect(
      htmlToText(
        '<body><nav>Menu</nav><script>var x = 1;</script><p>Real bio prose here.</p><footer>Contact</footer></body>',
      ),
    ).toBe('Real bio prose here.');
  });
});

describe('usefulLabName', () => {
  it('rejects a PI faculty title/credential line so it never becomes the entity name', () => {
    expect(usefulLabName('Joshua L. Warren Professor of Biostatistics, Yale University')).toBe('');
    expect(usefulLabName('Jane Doe, Associate Professor of Chemistry')).toBe('');
    expect(usefulLabName('John Smith, Ph.D.')).toBe('');
    expect(usefulLabName('Alan Edwards, M.D., Yale University')).toBe('');
  });

  // The placeholder vocabulary now lives in one shared predicate, so this source
  // rejects the values it never used to (#2367).
  it('rejects placeholder filler offered in place of a name', () => {
    for (const value of ['n/a', 'N / A', 'none', 'unknown', 'null', 'TBD', 'untitled', '???']) {
      expect(usefulLabName(value)).toBe('');
    }
  });

  it('rejects a bare research-home label with no branding', () => {
    for (const value of ['the lab', 'Lab', 'laboratory', 'Research']) {
      expect(usefulLabName(value)).toBe('');
    }
  });

  it('keeps a genuine branded research-home name', () => {
    expect(usefulLabName('The Yale GRAB Lab')).toBe('The Yale GRAB Lab');
    expect(usefulLabName('David Spiegel Lab')).toBe('David Spiegel Lab');
    expect(usefulLabName('The Efficient Computing Lab (ECL)')).toBe(
      'The Efficient Computing Lab (ECL)',
    );
  });
});

describe('descriptionExtractionToObservations name identity authority (#2234)', () => {
  const PROSE =
    'We study how cardiac tissue remodels after injury, combining live imaging with computational models to test how mechanical load reshapes the myocardium over time.';

  function nameValues(
    name: string,
    context: {
      sourceUrl: string;
      entityKey?: string;
      entityType?: string;
      kind?: string;
      recordCitedUrls?: unknown;
    },
  ) {
    return descriptionExtractionToObservations(
      { fullDescription: PROSE, shortDescription: '', topics: [], methods: [], name },
      { ...context, knownPersonSurnames: NO_SURNAME_ROSTER },
    )
      .filter((o) => o.field === 'name' || o.field === 'displayName')
      .map((o) => o.value);
  }

  it('emits nothing for an umbrella organization read off another school’s faculty-directory URL shape', () => {
    expect(
      nameValues('Yale Center for Customer Insights', {
        sourceUrl: 'https://som.yale.edu/faculty-research/faculty-directory/ravi-dhar',
        entityKey: 'dept-econ-ravi-dhar',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual([]);
    expect(
      nameValues('The Center for Industrial Ecology', {
        sourceUrl: 'https://environment.yale.edu/directory/faculty/yuan-yao',
        entityKey: 'yse-faculty-yuan-yao',
        entityType: 'LAB',
      }),
    ).toEqual([]);
  });

  it('emits nothing for an umbrella organization even when the page is not a directory page at all', () => {
    expect(
      nameValues('Yale Measurement Based Care Collaborative', {
        sourceUrl: 'https://medicine.yale.edu/psychiatry/research/clinics-and-programs/mbccollab/',
        entityKey: 'ysm-faculty-amber-childs',
        entityType: 'LAB',
      }),
    ).toEqual([]);
    expect(
      nameValues('HPV Working Group', {
        sourceUrl: 'https://medicine.yale.edu/lab/niccolai/',
        entityKey: 'niccolai-lab-lmn7',
        entityType: 'LAB',
      }),
    ).toEqual([]);
  });

  it('emits nothing when the page names another person’s lab', () => {
    expect(
      nameValues('The Liu Lab', {
        sourceUrl: 'https://medicine.yale.edu/lab/jun-liu/',
        entityKey: 'ysm-faculty-huaxin-yu',
        entityType: 'LAB',
      }),
    ).toEqual([]);
  });

  it('still emits that same lab name for the lab’s own entity', () => {
    expect(
      nameValues('The Liu Lab', {
        sourceUrl: 'https://medicine.yale.edu/lab/jun-liu/',
        entityKey: 'ysm-jun-liu',
        entityType: 'LAB',
      }),
    ).toEqual(['The Liu Lab', 'The Liu Lab']);
  });

  it('still emits an organization name for an organization-shaped entity', () => {
    expect(
      nameValues('Center for Cell and Molecular Imaging (CCMI)', {
        sourceUrl: 'https://research.yale.edu/cores/confocal-ccmi',
        entityKey: 'cores-confocal-ccmi',
        entityType: 'CORE_FACILITY',
      }),
    ).toEqual([
      'Center for Cell and Molecular Imaging (CCMI)',
      'Center for Cell and Molecular Imaging (CCMI)',
    ]);
  });

  it('still emits a real lab name harvested from a faculty-directory page', () => {
    expect(
      nameValues('Computational Biomechanics Laboratory', {
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/martin-pfaller/',
        entityKey: 'nih-pi-martin-pfaller',
        entityType: 'LAB',
      }),
    ).toEqual(['Computational Biomechanics Laboratory', 'Computational Biomechanics Laboratory']);
  });

  it('emits nothing when the name is that of a shared academic host the record cites', () => {
    // #2360: the name is the brand of a 13-faculty cross-department laboratory, read
    // off one member's faculty-directory page. Nothing in the string says so, and the
    // shared host the row cites is what does.
    expect(
      nameValues('Computer Systems Lab at Yale', {
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/',
        entityKey: 'nih-pi-quilla-marrowbane',
        entityType: 'LAB',
        recordCitedUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/',
          'https://csl.yale.edu/',
        ],
      }),
    ).toEqual([]);
  });

  it('still emits a member own lab name harvested while citing that same shared host', () => {
    const ownName = 'Analog and RF Circuits (ARC) Lab at Yale';
    expect(
      nameValues(ownName, {
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/',
        entityKey: 'nsf-pi-quilla-marrowbane',
        entityType: 'LAB',
        recordCitedUrls: ['https://csl.yale.edu/~quilla/'],
      }),
    ).toEqual([ownName, ownName]);
  });

  it('keeps refusing any name read off a person’s CMS profile page', () => {
    expect(
      nameValues('Some Research Home', {
        sourceUrl: 'https://medicine.yale.edu/profile/jordan-rivers/',
        entityKey: 'ysm-faculty-jordan-rivers',
        entityType: 'LAB',
      }),
    ).toEqual([]);
  });
});

describe('descriptionExtractionToObservations personal page of a LAB-typed row', () => {
  const BODY =
    'I use statistical and computational methods to study social networks, human behavior, and their interplay, developing tools to study them more efficiently.';

  function identityValues(
    name: string,
    context: { entityType: string; personName?: string; entityKey?: string },
  ) {
    return descriptionExtractionToObservations(
      { fullDescription: BODY, shortDescription: '', topics: [], methods: [], name },
      {
        sourceUrl: 'https://quillamarrow.github.io/',
        entityKey: context.entityKey ?? 'nsf-pi-0123456789abcdef01234567',
        entityType: context.entityType,
        personName: context.personName,
        knownPersonSurnames: NO_SURNAME_ROSTER,
      },
    )
      .filter((o) => ['name', 'displayName', 'entityType', 'kind'].includes(o.field))
      .map((o) => [o.field, o.value]);
  }

  it('asserts faculty research and the person-scoped name when the site names only the lead', () => {
    expect(
      identityValues('Quilla Marrowbane', { entityType: 'LAB', personName: 'Quilla Marrowbane' }),
    ).toEqual([
      ['name', 'Quilla Marrowbane Faculty Research'],
      ['displayName', 'Quilla Marrowbane Faculty Research'],
      ['entityType', 'FACULTY_RESEARCH_AREA'],
    ]);
  });

  it('accepts the lead name with a middle initial', () => {
    expect(
      identityValues('Quilla J. Marrowbane', {
        entityType: 'LAB',
        personName: 'Quilla Marrowbane',
      }).find(([field]) => field === 'entityType'),
    ).toEqual(['entityType', 'FACULTY_RESEARCH_AREA']);
  });

  it('leaves the type alone when the bare name is somebody other than the lead', () => {
    expect(
      identityValues('Orlen Vasquith', { entityType: 'LAB', personName: 'Quilla Marrowbane' }),
    ).toEqual([
      ['name', 'Orlen Vasquith'],
      ['displayName', 'Orlen Vasquith'],
    ]);
  });

  it('leaves the type alone when no lead is resolved', () => {
    expect(identityValues('Quilla Marrowbane', { entityType: 'LAB' })).toEqual([
      ['name', 'Quilla Marrowbane'],
      ['displayName', 'Quilla Marrowbane'],
    ]);
  });

  it('keeps the bare name on a row already typed as faculty research', () => {
    expect(
      identityValues('Quilla Marrowbane', {
        entityType: 'FACULTY_RESEARCH_AREA',
        personName: 'Quilla Marrowbane',
      }),
    ).toEqual([
      ['name', 'Quilla Marrowbane'],
      ['displayName', 'Quilla Marrowbane'],
    ]);
  });

  it('keeps a lab-named site on a LAB row as a lab', () => {
    expect(
      identityValues('Marrowbane Lab', { entityType: 'LAB', personName: 'Quilla Marrowbane' }),
    ).toEqual([
      ['name', 'Marrowbane Lab'],
      ['displayName', 'Marrowbane Lab'],
      ['entityType', 'LAB'],
      ['kind', 'lab'],
    ]);
  });
});

describe('descriptionExtractionToObservations third-party organization body (#2480)', () => {
  const INSTITUTIONAL_BODY =
    'The Northgate Measurement Based Care Collaborative is dedicated to implementation for systems, clinicians and clients, and advances measurement based care as an evidence-based practice through continued research.';
  const OWN_PROSE =
    'We study how cardiac tissue remodels after injury, combining live imaging with computational models to test how mechanical load reshapes the myocardium over time.';

  const fields = (
    fullDescription: string,
    context: { sourceUrl: string; entityKey?: string; entityType?: string; kind?: string },
  ) =>
    descriptionExtractionToObservations(
      {
        fullDescription,
        shortDescription: '',
        topics: ['Mental Health Services'],
        methods: [],
        name: '',
      },
      { ...context, knownPersonSurnames: NO_SURNAME_ROSTER },
    ).map((observation) => observation.field);

  it('emits nothing for a person-scoped row when the page describes another organization', () => {
    expect(
      fields(INSTITUTIONAL_BODY, {
        sourceUrl: 'https://example.edu/psychiatry/research/clinics-and-programs/mbccollab/',
        entityKey: 'directory-faculty-robin-hansen',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual([]);
  });

  it('still emits that body for the organization it describes', () => {
    expect(
      fields(INSTITUTIONAL_BODY, {
        sourceUrl: 'https://example.edu/psychiatry/research/clinics-and-programs/mbccollab/',
        entityKey: 'northgate-measurement-based-care-collaborative',
        entityType: 'CENTER',
      }),
    ).toContain('fullDescription');
  });

  it("still emits a person-scoped row's own research prose", () => {
    expect(
      fields(OWN_PROSE, {
        sourceUrl: 'https://example.edu/lab/hansen/',
        entityKey: 'directory-faculty-robin-hansen',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toContain('fullDescription');
  });
});

describe('a multi-project symposium booklet is never a lab description source (#1918)', () => {
  const BOOKLET_URL =
    'https://science.example.edu/sites/default/files/files/2025%20STARS2%20Symposium.pdf';
  const GRAFTED = {
    fullDescription:
      'The Quill Lab investigates the molecular mechanisms of cancer development and progression, aiming to identify therapeutic targets.',
    shortDescription:
      'Investigates the molecular mechanisms of cancer development and progression.',
    topics: ['Cancer Biology', 'Molecular mechanisms'],
    methods: ['Molecular biology', 'Biochemistry'],
    name: '',
  };
  const CONTEXT = {
    entityKey: 'dept-chemistry-robin-quill',
    entityType: 'LAB',
    kind: 'individual',
  };

  it('emits no observation of any field when the source is the booklet', () => {
    expect(
      descriptionExtractionToObservations(GRAFTED, {
        knownPersonSurnames: NO_SURNAME_ROSTER,
        ...CONTEXT,
        sourceUrl: BOOKLET_URL,
      }),
    ).toEqual([]);
  });

  it('still emits from the lab’s own page, so the refusal is about the source and not the prose', () => {
    const fields = descriptionExtractionToObservations(GRAFTED, {
      knownPersonSurnames: NO_SURNAME_ROSTER,
      ...CONTEXT,
      sourceUrl: 'https://www.quilllab.example.com/',
    }).map((observation) => observation.field);
    expect(fields).toContain('fullDescription');
    expect(fields).toContain('researchAreas');
  });

  it('never walks the crawl onto the booklet either, so it is not even fetched', () => {
    const anchor = `<a href="${BOOKLET_URL}">Research</a>`;
    expect(discoverResearchSubPageUrls(anchor, 'https://science.example.edu/programs/')).toEqual([
      BOOKLET_URL,
    ]);
    expect(researchSubPageCrawlUrls(anchor, 'https://science.example.edu/programs/')).toEqual([]);
  });
});

describe('a personal homepage bio is narrowed to the research it states', () => {
  const BIO_HOMEPAGE =
    'I am an assistant professor of Computer Science at Example University. Before that, I was a postdoc at the Department of Statistics of Northfield University. I received my PhD from the Department of Mathematics at Eastbrook Institute. During my Ph.D. studies, I was awarded the Example Society Dissertation Award and an Example Graduate Fellowship. My research interests include: Learning Theory, Optimization, Game Theory, and Mechanism Design.';
  const AWARD_CARD =
    'During my Ph.D. studies, I was awarded the Example Society Dissertation Award and an Example Graduate Fellowship.';
  const CONTEXT = {
    sourceUrl: 'https://example.org/',
    entityKey: 'dept-cs-faculty-example',
    entityType: 'FACULTY_RESEARCH_AREA',
    knownPersonSurnames: NO_SURNAME_ROSTER,
  };

  const observe = (fullDescription: string, shortDescription: string) =>
    Object.fromEntries(
      descriptionExtractionToObservations(
        { fullDescription, shortDescription, topics: [], methods: [], name: '' },
        CONTEXT,
      ).map((observation) => [observation.field, observation.value]),
    );

  it('keeps only the research-interests sentence of a first-person CV bio', () => {
    expect(observe(BIO_HOMEPAGE, '').fullDescription).toBe(
      'My research interests include: Learning Theory, Optimization, Game Theory, and Mechanism Design.',
    );
  });

  it('keeps the bio as the body when its research sentence is too thin to serve alone', () => {
    const thinBio = BIO_HOMEPAGE.replace(
      /My research interests include:.*$/,
      'I study learning theory and game theory.',
    );
    expect(observe(thinBio, '').fullDescription).toBe(thinBio);
  });

  it('keeps only the research sentences when they serve as a body on their own', () => {
    const proseBio = BIO_HOMEPAGE.replace(
      /My research interests include:.*$/,
      'My group studies how learning algorithms behave when the data they see is chosen strategically by other agents, and develops methods that remain reliable in that setting.',
    );
    expect(observe(proseBio, '').fullDescription).toBe(
      'My group studies how learning algorithms behave when the data they see is chosen strategically by other agents, and develops methods that remain reliable in that setting.',
    );
  });

  it('never asserts an award sentence as the card', () => {
    expect(observe(BIO_HOMEPAGE, AWARD_CARD).shortDescription).toBeUndefined();
  });

  it('keeps a bio whole when no sentence of it is recognised as research', () => {
    const careerOnly = BIO_HOMEPAGE.replace(/ My research interests include:.*$/, '');
    expect(researchSentencesOfBiographyBody(careerOnly)).toBe(careerOnly);
  });

  it('does not narrow at a boundary the splitters disagree on', () => {
    const ambiguous =
      'I am an assistant professor of Medicine at Example University. I received my M.D. at Example University in St. Louis where my dissertation examined cell signalling. My research interests include: kidney transport and ion channels in disease models.';
    expect(researchSentencesOfBiographyBody(ambiguous)).toBe(ambiguous);
    expect(observe(ambiguous, '').fullDescription).toBe(ambiguous);
  });

  it('leaves research prose without biography sentences untouched', () => {
    const prose =
      'We study how cardiac tissue remodels after injury, combining live imaging with computational models to test how mechanical load reshapes the myocardium.';
    expect(researchSentencesOfBiographyBody(prose)).toBe(prose);
  });

  it('keeps a career sentence that also states the research', () => {
    const prose =
      'After completing her doctorate, she joined the faculty, where she studies how coastal wetlands store carbon. Her group combines field sampling with isotope modelling.';
    expect(researchSentencesOfBiographyBody(prose)).toBe(prose);
  });
});

describe("htmlToText leaves out other units' teaser cards (#4823)", () => {
  const card = (href: string, text: string) =>
    `<li><div class="cores-card listing-item"><h2><a href="${href}">Other unit</a></h2><p>${text}</p></div></li>`;
  const html = `<body><main><p>We test samples for veterinary pathogens by PCR and serology.</p><ul>${card('/cores/b', 'Offers targeted metabolomics and isotope flux analysis.')}${card('/cores/c', 'Provides high-throughput screening with small molecules.')}</ul></main></body>`;

  it('drops sibling-unit teaser text when the page URL is known', () => {
    const text = htmlToText(html, 'https://research.example.edu/cores/a');
    expect(text).toContain('veterinary pathogens');
    expect(text).not.toContain('metabolomics');
    expect(text).not.toContain('high-throughput screening');
  });

  it('keeps every card when the page URL is unknown', () => {
    expect(htmlToText(html)).toContain('metabolomics');
  });
});

describe('descriptionPageNamesRowLead (#4809)', () => {
  const base = {
    personName: 'Robin Fixturely',
    websiteUrl: 'https://medicine.example.edu/lab/fixturely/',
    rowName: 'Fixturely Lab',
    kind: 'lab',
  };

  it("refuses a department page that never names the row's lead", () => {
    expect(
      descriptionPageNamesRowLead({
        ...base,
        pageUrl: 'https://medicine.example.edu/psychiatry/',
        pageText: 'The department offers clinical services across the lifespan.',
      }),
    ).toBe(false);
  });

  it('accepts a page that names the lead, ignoring case, accents and apostrophes', () => {
    expect(
      descriptionPageNamesRowLead({
        personName: "Ana O'Fixtúre",
        kind: 'individual',
        pageUrl: 'https://example.edu/research',
        pageText: 'Research led by Dr. Ana OFIXTURE on coral reefs.',
      }),
    ).toBe(true);
  });

  it("exempts the row's own website, which may name its lead only in an image", () => {
    expect(
      descriptionPageNamesRowLead({
        ...base,
        pageUrl: 'https://medicine.example.edu/lab/fixturely/research/',
        pageText: 'We study cellular signaling with live imaging.',
      }),
    ).toBe(true);
  });

  it('leaves a unit named for its work to its own page', () => {
    expect(
      descriptionPageNamesRowLead({
        personName: 'Robin Fixturely',
        rowName: 'Coastal Ecology Center',
        kind: 'center',
        pageUrl: 'https://example.edu/centers/coastal',
        pageText: 'The center studies coastal ecosystems.',
      }),
    ).toBe(true);
  });

  it('counts a page whose address carries the surname as naming the row', () => {
    expect(
      descriptionPageNamesRowLead({
        ...base,
        websiteUrl: 'http://www.example.edu/fixturelylab/',
        pageUrl: 'https://fixturelylab.example.edu/',
        pageText: 'We study cellular signaling with live imaging.',
      }),
    ).toBe(true);
  });

  it('takes the surname from a display name that carries a credential suffix', () => {
    expect(
      descriptionPageNamesRowLead({
        ...base,
        personName: 'Robin Fixturely, MD',
        pageUrl: 'https://medicine.example.edu/psychiatry/',
        pageText: 'The department offers clinical services across the lifespan.',
      }),
    ).toBe(false);
    expect(
      descriptionPageNamesRowLead({
        ...base,
        personName: 'Robin Fixturely, MD',
        pageUrl: 'https://medicine.example.edu/psychiatry/',
        pageText: 'Dr. Fixturely leads work on cellular signaling.',
      }),
    ).toBe(true);
  });

  it('does not read a two-letter surname inside an unrelated address word', () => {
    expect(
      descriptionPageNamesRowLead({
        personName: 'Robin Ma',
        rowName: 'Ma Lab',
        kind: 'lab',
        pageUrl: 'https://medicine.example.edu/dermatology/clinical/',
        pageText: 'The section offers clinical services across the lifespan.',
      }),
    ).toBe(false);
    expect(
      descriptionPageNamesRowLead({
        personName: 'Robin Ma',
        rowName: 'Ma Lab',
        kind: 'lab',
        pageUrl: 'https://medicine.example.edu/lab/ma-lab/',
        pageText: 'We study cellular signaling with live imaging.',
      }),
    ).toBe(true);
  });

  it('matches a surname shorter than four letters only as a whole address token', () => {
    const shortLead = { personName: 'Robin Ma', rowName: 'Ma Lab', kind: 'lab' };
    const neverNamed = 'The section offers clinical services across the lifespan.';
    for (const path of ['health', 'life', 'mathematics']) {
      expect(
        descriptionPageNamesRowLead({
          ...shortLead,
          pageUrl: `https://medicine.example.edu/${path}/research/`,
          pageText: neverNamed,
        }),
      ).toBe(false);
    }
    expect(
      descriptionPageNamesRowLead({
        ...shortLead,
        personName: 'Robin He',
        rowName: 'He Lab',
        pageUrl: 'https://medicine.example.edu/health/research/',
        pageText: neverNamed,
      }),
    ).toBe(false);
    expect(
      descriptionPageNamesRowLead({
        ...shortLead,
        personName: 'Robin Li',
        rowName: 'Li Lab',
        pageUrl: 'https://medicine.example.edu/life/research/',
        pageText: neverNamed,
      }),
    ).toBe(false);
    expect(
      descriptionPageNamesRowLead({
        ...shortLead,
        pageUrl: 'https://medicine.example.edu/people/ma/research/',
        pageText: neverNamed,
      }),
    ).toBe(true);
  });

  it('applies to no row without a known lead', () => {
    expect(
      descriptionPageNamesRowLead({ pageUrl: 'https://example.edu/', pageText: 'Anything.' }),
    ).toBe(true);
  });
});
