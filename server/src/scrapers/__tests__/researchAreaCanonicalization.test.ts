import { afterEach, describe, expect, it } from 'vitest';
import {
  applyResearchEntityResearchAreaCanonicalization,
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  researchAreaMatchKey,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

const rows = [
  { name: 'Artificial Intelligence' },
  { name: 'Machine Learning' },
  { name: 'Computer Vision' },
  { name: 'Human-Computer Interaction' },
  { name: 'Neuroscience' },
  { name: 'Public Health' },
  { name: 'Climate Change' },
  { name: 'Economics' },
];

const index = buildResearchAreaResolverIndex(rows);
const canonicalizer = createResearchAreaCanonicalizer(index);

afterEach(() => {
  resetResearchAreaCanonicalizerCache();
});

describe('researchAreaMatchKey', () => {
  it('normalizes case, punctuation, and ampersands', () => {
    expect(researchAreaMatchKey('Machine Learning')).toBe('machine-learning');
    expect(researchAreaMatchKey('machine   learning')).toBe('machine-learning');
    expect(researchAreaMatchKey('Human-Computer Interaction')).toBe('human-computer-interaction');
    expect(researchAreaMatchKey(42)).toBe('');
  });
});

describe('canonicalizeResearchAreas', () => {
  it('maps exact names and curated aliases to canonical values', () => {
    const result = canonicalizer.canonicalizeResearchAreas([
      'machine learning',
      'AI',
      'HCI',
    ]);
    expect(result.values).toEqual([
      'Machine Learning',
      'Artificial Intelligence',
      'Human-Computer Interaction',
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('fails closed: keeps unmatched raw strings and reports them for review', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['Basket Weaving', 'Neuroscience']);
    expect(result.values).toEqual(['Basket Weaving', 'Neuroscience']);
    expect(result.unmatched).toEqual(['Basket Weaving']);
  });

  it('dedupes canonical collisions case-insensitively', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['AI', 'artificial intelligence']);
    expect(result.values).toEqual(['Artificial Intelligence']);
  });
});

describe('matchCanonicalResearchAreas', () => {
  it('returns only canonical matches and drops unmatched candidates', () => {
    expect(
      canonicalizer.matchCanonicalResearchAreas(['Economics', 'Underwater Ceramics']),
    ).toEqual(['Economics']);
  });
});

describe('deriveResearchAreasFromText', () => {
  it('finds multi-word canonical phrases as whole-word matches', () => {
    const text =
      'Our lab studies machine learning and computer vision for climate change adaptation.';
    expect(canonicalizer.deriveResearchAreasFromText(text)).toEqual(
      expect.arrayContaining(['Machine Learning', 'Computer Vision', 'Climate Change']),
    );
  });

  it('does not match a multi-word phrase glued inside a longer token', () => {
    expect(canonicalizer.deriveResearchAreasFromText('biomachine learning device')).toEqual([]);
  });

  it('does not derive an ambiguous single-word area (economics) from prose', () => {
    expect(canonicalizer.deriveResearchAreasFromText('the state of the art in economics')).toEqual(
      [],
    );
  });

  it('matches a multi-word alias in prose', () => {
    expect(
      canonicalizer.deriveResearchAreasFromText('work on human computer interaction methods'),
    ).toEqual(['Human-Computer Interaction']);
  });
});

describe('single-word specific-term derivation', () => {
  const specificRows = [
    { name: 'Immunology' },
    { name: 'Genomics' },
    { name: 'Bioinformatics' },
    { name: 'Neuroscience' },
    { name: 'Machine Learning' },
    { name: 'Art' },
    { name: 'History' },
    { name: 'Statistics' },
    { name: 'Economics' },
    { name: 'Art History' },
  ];
  const specific = createResearchAreaCanonicalizer(buildResearchAreaResolverIndex(specificRows));

  it('derives specific single-word technical terms from prose', () => {
    expect(
      specific.deriveResearchAreasFromText(
        'The lab studies immunology and genomics using bioinformatics pipelines.',
      ),
    ).toEqual(expect.arrayContaining(['Immunology', 'Genomics', 'Bioinformatics']));
  });

  it('keeps ambiguous single-word names out of prose derivation', () => {
    const derived = specific.deriveResearchAreasFromText(
      'A survey of the history of art, with attention to economics and statistics.',
    );
    expect(derived).not.toContain('Art');
    expect(derived).not.toContain('History');
    expect(derived).not.toContain('Economics');
    expect(derived).not.toContain('Statistics');
  });

  it('still derives a multi-word area whose words are individually ambiguous', () => {
    expect(specific.deriveResearchAreasFromText('a course in art history and criticism')).toEqual([
      'Art History',
    ]);
  });

  it('does not fire a single-word term glued inside a longer token', () => {
    expect(specific.deriveResearchAreasFromText('immunologist training program')).toEqual([]);
  });

  it('resolves an ambiguous single-word area through the exact index', () => {
    expect(specific.matchCanonicalResearchAreas(['Economics', 'Statistics'])).toEqual([
      'Economics',
      'Statistics',
    ]);
  });
});

describe('finance and business single-word derivation precision', () => {
  const financeRows = [
    { name: 'Accounting' },
    { name: 'Auditing' },
    { name: 'Banking' },
    { name: 'Genomics' },
  ];
  const finance = createResearchAreaCanonicalizer(buildResearchAreaResolverIndex(financeRows));

  it('does not derive finance idiom words from non-topical prose', () => {
    const derived = finance.deriveResearchAreasFromText(
      'Estimates adjust for confounders after accounting for age and sex, banking on repeated measures while auditing the analysis pipeline; the team also studies genomics.',
    );
    expect(derived).not.toContain('Accounting');
    expect(derived).not.toContain('Auditing');
    expect(derived).not.toContain('Banking');
    expect(derived).toContain('Genomics');
  });

  it('still resolves finance areas through the exact index', () => {
    expect(finance.matchCanonicalResearchAreas(['Accounting', 'Banking', 'Auditing'])).toEqual([
      'Accounting',
      'Banking',
      'Auditing',
    ]);
  });
});

describe('mathematics idiom single-word derivation precision', () => {
  const mathRows = [{ name: 'Topology' }, { name: 'Optics' }, { name: 'Genomics' }];
  const math = createResearchAreaCanonicalizer(buildResearchAreaResolverIndex(mathRows));

  it('does not derive Topology from the "network topology" idiom', () => {
    const derived = math.deriveResearchAreasFromText(
      'The group designs distributed systems and studies network topology and optics for sensor genomics.',
    );
    expect(derived).not.toContain('Topology');
    expect(derived).toContain('Optics');
    expect(derived).toContain('Genomics');
  });

  it('still resolves Topology through the exact index', () => {
    expect(math.matchCanonicalResearchAreas(['Topology'])).toEqual(['Topology']);
  });
});

describe('generic seeded single-word derivation precision', () => {
  const genericRows = [
    { name: 'Aesthetics' },
    { name: 'Classics' },
    { name: 'Immigration' },
    { name: 'Photography' },
    { name: 'Sustainability' },
    { name: 'Genomics' },
  ];
  const generic = createResearchAreaCanonicalizer(buildResearchAreaResolverIndex(genericRows));

  it('does not derive generic seeded words from non-topical prose', () => {
    const derived = generic.deriveResearchAreasFromText(
      'The team weighs the aesthetics of the interface and the long-term sustainability of the program, drawing on classics of the field, while immigration reshaped the cohort and photography documented the work; separately they study genomics.',
    );
    expect(derived).not.toContain('Aesthetics');
    expect(derived).not.toContain('Classics');
    expect(derived).not.toContain('Immigration');
    expect(derived).not.toContain('Photography');
    expect(derived).not.toContain('Sustainability');
    expect(derived).toContain('Genomics');
  });

  it('still resolves generic seeded areas through the exact index', () => {
    expect(
      generic.matchCanonicalResearchAreas([
        'Aesthetics',
        'Classics',
        'Immigration',
        'Photography',
        'Sustainability',
      ]),
    ).toEqual(['Aesthetics', 'Classics', 'Immigration', 'Photography', 'Sustainability']);
  });
});

describe('applyResearchEntityResearchAreaCanonicalization', () => {
  it('rewrites the set researchAreas in place and reports unmatched', async () => {
    setResearchAreaCanonicalizerForTesting(canonicalizer);
    const set: Record<string, unknown> = { researchAreas: ['AI', 'Quilting'] };
    const result = await applyResearchEntityResearchAreaCanonicalization(set);
    expect(set.researchAreas).toEqual(['Artificial Intelligence', 'Quilting']);
    expect(result.unmatchedResearchAreas).toEqual(['Quilting']);
  });

  it('is a no-op when researchAreas is absent', async () => {
    setResearchAreaCanonicalizerForTesting(canonicalizer);
    const set: Record<string, unknown> = { school: 'Yale College' };
    const result = await applyResearchEntityResearchAreaCanonicalization(set);
    expect(set).toEqual({ school: 'Yale College' });
    expect(result.unmatchedResearchAreas).toEqual([]);
  });
});
