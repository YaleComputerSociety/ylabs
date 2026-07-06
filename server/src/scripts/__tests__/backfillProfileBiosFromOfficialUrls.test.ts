import { describe, expect, it } from 'vitest';

import {
  articleForFacultyTitle,
  composeTitleLedBio,
  decideBioBackfill,
  detectFieldMismatch,
  extractBiographySection,
  groundedInterestTerms,
  htmlToText,
  parseProfileBioBackfillArgs,
  profileBioQuality,
  selectOfficialBioUrl,
  selectOfficialBioUrlFromHomes,
} from '../backfillProfileBiosFromOfficialUrls';

const RESEARCH_SOURCE =
  'Jane Researcher studies the neural circuits underlying memory formation in the hippocampus, ' +
  'combining electrophysiology, optogenetics, and computational modeling to understand how synaptic ' +
  'plasticity supports learning across developmental stages in rodent models.';

describe('selectOfficialBioUrl', () => {
  it('prefers a person-matching Yale /profile/ URL over directory pages', () => {
    const url = selectOfficialBioUrl(
      {
        departmental: 'https://psychology.yale.edu/people/jane-researcher',
        official: 'https://medicine.yale.edu/profile/jane-researcher/',
      },
      '',
      'Jane',
      'Researcher',
    );
    expect(url).toBe('https://medicine.yale.edu/profile/jane-researcher/');
  });

  it('falls back to a Yale people page when no /profile/ page exists', () => {
    const url = selectOfficialBioUrl(
      { departmental: 'https://psychology.yale.edu/people/jane-researcher' },
      '',
      'Jane',
      'Researcher',
    );
    expect(url).toBe('https://psychology.yale.edu/people/jane-researcher');
  });

  it('rejects non-Yale, grant, ORCID, and non-person URLs', () => {
    expect(selectOfficialBioUrl({ official: 'https://example.com/profile/jane' }, '', 'Jane', 'Researcher')).toBe('');
    expect(selectOfficialBioUrl({ orcid: 'https://orcid.org/0000-0001' }, '', 'Jane', 'Researcher')).toBe('');
    expect(
      selectOfficialBioUrl(
        { official: 'https://reporter.nih.gov/project-details/12345' },
        '',
        'Jane',
        'Researcher',
      ),
    ).toBe('');
    // A Yale profile page for a clearly different person should not match.
    expect(
      selectOfficialBioUrl(
        { official: 'https://medicine.yale.edu/profile/robert-smith/' },
        '',
        'Jane',
        'Researcher',
      ),
    ).toBe('');
  });
});

describe('selectOfficialBioUrlFromHomes', () => {
  it('pulls a person-matching official Yale URL from research-home sourceUrls', () => {
    const url = selectOfficialBioUrlFromHomes(
      [
        {
          name: 'Pat Fixture — Research',
          websiteUrl: '',
          sourceUrls: ['https://medicine.yale.edu/profile/pat-fixture/'],
        },
      ],
      'Pat',
      'Fixture',
    );
    expect(url).toBe('https://medicine.yale.edu/profile/pat-fixture/');
  });

  it('accepts a Yale /people/ home websiteUrl when it matches the person', () => {
    const url = selectOfficialBioUrlFromHomes(
      [{ name: 'Abraham Silberschatz Faculty Research', websiteUrl: 'https://cs.yale.edu/people/abraham-silberschatz' }],
      'Abraham',
      'Silberschatz',
    );
    expect(url).toBe('https://cs.yale.edu/people/abraham-silberschatz');
  });

  it('ignores grant/non-Yale/mismatched sources', () => {
    expect(
      selectOfficialBioUrlFromHomes(
        [{ sourceUrls: ['https://reporter.nih.gov/project-details/9', 'https://example.com/profile/fixture-profile-bio'] }],
        'Pat',
        'Fixture',
      ),
    ).toBe('');
    expect(
      selectOfficialBioUrlFromHomes(
        [{ sourceUrls: ['https://medicine.yale.edu/profile/someone-else/'] }],
        'Pat',
        'Fixture',
      ),
    ).toBe('');
  });
});

describe('htmlToText', () => {
  it('strips scripts/nav and returns body text', () => {
    const html =
      '<html><head><style>.x{}</style></head><body><nav>menu</nav><p>Hello world research.</p>' +
      '<script>var x = 1;</script></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Hello world research.');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('menu');
  });
});

describe('groundedInterestTerms', () => {
  it('keeps only terms whose words appear in the source', () => {
    const terms = groundedInterestTerms(
      ['memory formation', 'synaptic plasticity', 'quantum gravity'],
      RESEARCH_SOURCE,
    );
    expect(terms).toContain('memory formation');
    expect(terms).toContain('synaptic plasticity');
    expect(terms).not.toContain('quantum gravity');
  });

  it('dedupes and caps length', () => {
    expect(groundedInterestTerms(['Memory Formation', 'memory formation'], RESEARCH_SOURCE)).toEqual([
      'Memory Formation',
    ]);
  });
});

const YSM_PAGE_TEXT =
  'Skip to Main ContentMENUAbout Find People BiographyDr. Jane Researcher received her PhD from ' +
  'Stanford University and completed postdoctoral training at MIT. She joined the Yale faculty in 2015. ' +
  'Her research studies the neural circuits underlying memory formation in the hippocampus, combining ' +
  'electrophysiology, optogenetics, and computational modeling to understand how synaptic plasticity ' +
  'supports learning. Last Updated on May 1, 2025.AppointmentsNeuroscienceProfessorEducation & Training ' +
  'PhD Stanford University';

describe('extractBiographySection', () => {
  it('slices the Biography prose between the heading and the next section, dropping the Last Updated trailer', () => {
    const section = extractBiographySection(YSM_PAGE_TEXT);
    expect(section.startsWith('Dr. Jane Researcher received her PhD')).toBe(true);
    expect(section).toContain('memory formation in the hippocampus');
    expect(section).not.toMatch(/Last Updated on/i);
    expect(section).not.toMatch(/Appointments/);
  });

  it('returns empty when there is no biography heading', () => {
    expect(extractBiographySection('Some department roster page with names and links.')).toBe('');
  });
});

describe('articleForFacultyTitle', () => {
  it('uses "the" for named/endowed chairs', () => {
    expect(articleForFacultyTitle('C.N.H. Long Professor of Pediatrics')).toBe('the');
    expect(articleForFacultyTitle('Sterling Professor of History')).toBe('the');
  });

  it('uses a/an for plain ranks', () => {
    expect(articleForFacultyTitle('Assistant Professor of History')).toBe('an');
    expect(articleForFacultyTitle('Professor of Architecture')).toBe('a');
    expect(articleForFacultyTitle('Senior Lecturer in Spanish')).toBe('a');
  });
});

describe('composeTitleLedBio', () => {
  it('leads with the authoritative title and appends the research sentence', () => {
    const bio = composeTitleLedBio(
      'Brian Feldman',
      'C.N.H. Long Professor of Pediatrics',
      'Research focuses on the role of steroid hormones in determining cell fate',
    );
    expect(bio).toBe(
      'Brian Feldman is the C.N.H. Long Professor of Pediatrics at Yale. ' +
        'Research focuses on the role of steroid hormones in determining cell fate.',
    );
  });

  it('does not double an existing affiliation in the title', () => {
    const bio = composeTitleLedBio(
      'Tim Gregoire',
      'J.P. Weyerhaeuser, Jr. Professor Emeritus at the School of the Environment',
      'Research examines forest carbon budgets',
    );
    expect(bio).not.toMatch(/at Yale/);
    expect(bio).toContain('at the School of the Environment.');
  });

  it('returns empty without a research sentence (never a bare appointment line)', () => {
    expect(composeTitleLedBio('Jane Doe', 'Assistant Professor of History', '')).toBe('');
  });
});

describe('profileBioQuality', () => {
  const goodPageBio =
    'Dr. Jane Researcher received her PhD from Stanford University and joined the Yale faculty in 2015. ' +
    'Her work studies the neural circuits underlying memory formation in the hippocampus.';

  it('accepts a third-person biographical narrative with degrees and appointments', () => {
    expect(profileBioQuality(goodPageBio).isUseful).toBe(true);
  });

  it('rejects first-person, chrome, publication-list, and truncated bios', () => {
    expect(profileBioQuality('I am a professor at Yale who studies memory and learning in the brain.').flags).toContain(
      'first-person',
    );
    expect(
      profileBioQuality(
        'Dr. Smith studies memory. Skip to Main Content. View full profile for more details about this work.',
      ).flags,
    ).toContain('chrome');
    expect(
      profileBioQuality(
        'Dr. Smith studies memory formation in the hippocampus across rodent models and human subjects. PMID: 12345678.',
      ).flags,
    ).toContain('publication-list');
    expect(
      profileBioQuality(
        'Dr. Smith studies memory formation in the hippocampus across rodent models and is the first publicati',
      ).flags,
    ).toContain('incomplete-sentence');
  });
});

describe('detectFieldMismatch', () => {
  it('flags a bio whose topics do not intersect the field corpus', () => {
    expect(
      detectFieldMismatch(
        'Alan Rooney focuses on the intersection of health equity and community engagement initiatives.',
        'Assistant Professor of Earth & Planetary Sciences geochemistry geochronology rhenium osmium',
      ),
    ).toBe(true);
  });

  it('does not flag a bio that shares meaningful field words', () => {
    expect(
      detectFieldMismatch(
        'Brian Feldman studies steroid hormones, adipogenesis, and metabolic disease.',
        'Professor of Pediatrics Endocrinology metabolic hormones adipogenesis diabetes',
      ),
    ).toBe(false);
  });
});

describe('decideBioBackfill', () => {
  it('prefers the real page Biography section as the bio', () => {
    const decision = decideBioBackfill({
      name: 'Jane Researcher',
      title: 'Professor of Neuroscience',
      pageBiography: '',
      researchSummary: 'Research studies memory formation',
      interests: ['memory formation', 'synaptic plasticity'],
      sourceText: YSM_PAGE_TEXT,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.source).toBe('page-section');
    expect(decision.bio).toContain('received her PhD');
    expect(decision.interests).toContain('memory formation');
  });

  it('uses the LLM-extracted page biography when grounded and no section heading exists', () => {
    const pageText =
      'Jane Researcher is a Professor of Neuroscience at Yale. She received her PhD from Stanford ' +
      'University and studies the neural circuits underlying memory formation in the hippocampus.';
    const decision = decideBioBackfill({
      name: 'Jane Researcher',
      title: 'Professor of Neuroscience',
      pageBiography:
        'Jane Researcher is a Professor of Neuroscience at Yale. She received her PhD from Stanford ' +
        'University and studies the neural circuits underlying memory formation in the hippocampus.',
      researchSummary: 'Research studies memory formation',
      interests: [],
      sourceText: pageText,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.source).toBe('page-llm');
  });

  it('falls back to a title-led composed bio when no page narrative exists', () => {
    const decision = decideBioBackfill({
      name: 'Jane Researcher',
      title: 'Assistant Professor of Neuroscience',
      pageBiography: '',
      researchSummary:
        'Research focuses on the neural circuits underlying memory formation in the hippocampus and synaptic plasticity',
      interests: [],
      sourceText: RESEARCH_SOURCE,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.source).toBe('composed');
    expect(decision.bio).toContain('Jane Researcher is an Assistant Professor of Neuroscience at Yale.');
  });

  it('rejects when there is no page bio and no grounded research summary', () => {
    const decision = decideBioBackfill({
      name: 'Jane Researcher',
      title: 'Assistant Professor of Neuroscience',
      pageBiography: '',
      researchSummary: 'Research focuses on marine coral reef carbon sequestration across tropical biomes',
      interests: [],
      sourceText: RESEARCH_SOURCE,
    });
    expect(decision.accepted).toBe(false);
    expect(decision.bio).toBe('');
  });
});

describe('parseProfileBioBackfillArgs', () => {
  it('defaults to dry-run', () => {
    const options = parseProfileBioBackfillArgs([]);
    expect(options.dryRun).toBe(true);
    expect(options.confirm).toBe(false);
    expect(options.explicitLimit).toBe(false);
    expect(options.regenerate).toBe(false);
  });

  it('parses apply + confirm + limit + regenerate + output', () => {
    const options = parseProfileBioBackfillArgs([
      '--apply',
      '--confirm-profile-bios',
      '--regenerate',
      '--limit=10',
      '--output=/tmp/out.json',
    ]);
    expect(options.dryRun).toBe(false);
    expect(options.confirm).toBe(true);
    expect(options.regenerate).toBe(true);
    expect(options.limit).toBe(10);
    expect(options.explicitLimit).toBe(true);
    expect(options.output).toBe('/tmp/out.json');
  });

  it('rejects a non-positive limit and unknown args', () => {
    expect(() => parseProfileBioBackfillArgs(['--limit=0'])).toThrow();
    expect(() => parseProfileBioBackfillArgs(['--bogus'])).toThrow();
  });
});
