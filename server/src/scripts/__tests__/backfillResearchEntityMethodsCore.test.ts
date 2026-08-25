import { describe, expect, it } from 'vitest';
import {
  fetchablePageUrls,
  groundMethods,
  hasFetchablePageSource,
  isMethodGroundedInText,
  isMethodsBackfillCandidate,
  parseMethodsExtraction,
  selectMethodsBackfillTargets,
  type MethodsBackfillCandidateDoc,
} from '../backfillResearchEntityMethodsCore';

const baseDoc = (over: Partial<MethodsBackfillCandidateDoc> = {}): MethodsBackfillCandidateDoc => ({
  _id: 'a',
  slug: 'some-lab',
  entityType: 'LAB',
  studentVisibilityTier: 'student_ready',
  ...over,
});

describe('isMethodsBackfillCandidate', () => {
  it('accepts a visible research-home lacking methods', () => {
    expect(isMethodsBackfillCandidate(baseDoc())).toBe(true);
  });

  it('rejects archived, hidden, or non-research-home entities', () => {
    expect(isMethodsBackfillCandidate(baseDoc({ archived: true }))).toBe(false);
    expect(isMethodsBackfillCandidate(baseDoc({ studentVisibilityTier: 'suppressed' }))).toBe(false);
    expect(isMethodsBackfillCandidate(baseDoc({ entityType: 'FELLOWSHIP_PROGRAM' }))).toBe(false);
    expect(isMethodsBackfillCandidate(baseDoc({ entityType: 'COLLECTIONS_INITIATIVE' }))).toBe(false);
  });

  it('rejects entities that already carry methods or lock the field', () => {
    expect(isMethodsBackfillCandidate(baseDoc({ methods: ['fMRI'] }))).toBe(false);
    expect(isMethodsBackfillCandidate(baseDoc({ manuallyLockedFields: ['methods'] }))).toBe(false);
  });

  it('treats an empty methods array as a candidate', () => {
    expect(isMethodsBackfillCandidate(baseDoc({ methods: [] }))).toBe(true);
  });
});

describe('selectMethodsBackfillTargets', () => {
  it('keeps only qualifying docs', () => {
    const docs = [
      baseDoc({ slug: 'keep' }),
      baseDoc({ slug: 'drop-has-methods', methods: ['PCR'] }),
      baseDoc({ slug: 'drop-program', entityType: 'PROGRAM' }),
    ];
    expect(selectMethodsBackfillTargets(docs).map((d) => d.slug)).toEqual(['keep']);
  });
});

describe('fetchablePageUrls', () => {
  it('skips URLs flagged UNAVAILABLE or with a 4xx/5xx status', () => {
    const doc = baseDoc({
      websiteUrl: 'https://medicine.yale.edu/lab/solomon/',
      sourceUrls: [
        'https://medicine.yale.edu/lab/solomon/publications/',
        'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
      ],
      sourceLinkHealth: [
        { url: 'https://medicine.yale.edu/lab/solomon/', healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        { url: 'https://medicine.yale.edu/lab/solomon/publications/', httpStatusCode: 404 },
        { url: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/', healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ],
    });
    expect(fetchablePageUrls(doc)).toEqual([
      'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
    ]);
    expect(hasFetchablePageSource(doc)).toBe(true);
  });

  it('matches health entries regardless of trailing slash and de-duplicates', () => {
    const doc = baseDoc({
      websiteUrl: 'https://x.example/lab',
      sourceUrls: ['https://x.example/lab/'],
      sourceLinkHealth: [{ url: 'https://x.example/lab/', healthStatus: 'UNAVAILABLE' }],
    });
    expect(fetchablePageUrls(doc)).toEqual([]);
    expect(hasFetchablePageSource(doc)).toBe(false);
  });

  it('keeps URLs with no health record (unknown is fetchable)', () => {
    const doc = baseDoc({ websiteUrl: 'https://y.example/lab', sourceLinkHealth: [] });
    expect(fetchablePageUrls(doc)).toEqual(['https://y.example/lab']);
  });
});

describe('isMethodGroundedInText', () => {
  const text = 'We use functional MRI and single-cell RNA sequencing to study cortical circuits.';

  it('keeps a method whose significant words all appear in the source', () => {
    expect(isMethodGroundedInText('functional MRI', text)).toBe(true);
    expect(isMethodGroundedInText('single-cell RNA sequencing', text)).toBe(true);
  });

  it('allows reordering and stopword differences', () => {
    expect(isMethodGroundedInText('MRI (functional)', text)).toBe(true);
  });

  it('rejects a fabricated method not present in the source', () => {
    expect(isMethodGroundedInText('mass spectrometry', text)).toBe(false);
  });

  it('rejects content-free phrases', () => {
    expect(isMethodGroundedInText('research methods', text)).toBe(false);
    expect(isMethodGroundedInText('various techniques', text)).toBe(false);
  });
});

describe('groundMethods', () => {
  const text = 'Techniques include CRISPR screening, live-cell imaging, and flow cytometry.';

  it('returns only grounded, de-duplicated methods within the limit', () => {
    const result = groundMethods(
      ['CRISPR screening', 'crispr screening', 'live-cell imaging', 'fabricated assay'],
      text,
    );
    expect(result).toEqual(['CRISPR screening', 'live-cell imaging']);
  });

  it('caps the number of returned methods', () => {
    const many = Array.from({ length: 20 }, (_, i) => `flow cytometry ${i}`);
    expect(groundMethods(many, `${text} ${many.join(' ')}`, 5)).toHaveLength(5);
  });

  it('returns an empty array for non-array input', () => {
    expect(groundMethods(undefined, text)).toEqual([]);
    expect(groundMethods('flow cytometry', text)).toEqual([]);
  });
});

describe('parseMethodsExtraction', () => {
  it('parses a well-formed methods array', () => {
    expect(parseMethodsExtraction('{"methods":["PCR","western blot"]}')).toEqual([
      'PCR',
      'western blot',
    ]);
  });

  it('drops non-string entries and tolerates malformed payloads', () => {
    expect(parseMethodsExtraction('{"methods":["PCR",7,null]}')).toEqual(['PCR']);
    expect(parseMethodsExtraction('not json')).toEqual([]);
    expect(parseMethodsExtraction('{"other":true}')).toEqual([]);
  });
});
