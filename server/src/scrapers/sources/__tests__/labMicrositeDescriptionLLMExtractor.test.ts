import { describe, it, expect } from 'vitest';
import {
  htmlToText,
  isRejectedDescriptionSourceUrl,
  usefulLabName,
  descriptionExtractionToObservations,
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
    context: { sourceUrl: string; entityKey?: string; entityType?: string; kind?: string },
  ) {
    return descriptionExtractionToObservations(
      { fullDescription: PROSE, shortDescription: '', topics: [], methods: [], name },
      context,
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
