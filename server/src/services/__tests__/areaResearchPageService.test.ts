import { describe, expect, it } from 'vitest';
import { buildAreaResearchPage } from '../areaResearchPageService';
import type { AccessSummary } from '../accessSummaryService';

const entity = (overrides: Record<string, unknown>) => ({
  slug: 'x',
  name: 'X',
  entityType: 'LAB',
  researchAreas: ['Neuroscience'],
  sourceUrls: ['https://example.edu/lab'],
  studentVisibilityTier: 'student_ready',
  shortDescription: 'Studies the neural basis of memory.',
  ...overrides,
});

const summary = (status: AccessSummary['status']): AccessSummary => ({
  status,
  confidence: 0.9,
  evidence: [],
  signalTypes: [],
  bestNextStep: 'Apply through the posted role',
});

const areaScope = {
  kind: 'area' as const,
  slug: 'neuroscience',
  name: 'Neuroscience',
  colorKey: 'red',
  field: 'Life Sciences & Biology',
};

describe('buildAreaResearchPage', () => {
  it('returns an honest empty page when no entities match', () => {
    const page = buildAreaResearchPage(areaScope, [], new Map());
    expect(page.scope).toEqual(areaScope);
    expect(page.buckets).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.waysIn.researchEntities).toEqual([]);
    expect(page.waysIn.totalCount).toBe(0);
  });

  it('groups the footprint into research-type buckets in canonical order', () => {
    const page = buildAreaResearchPage(
      areaScope,
      [
        entity({ slug: 'lab-a', name: 'Memory Lab', entityType: 'LAB' }),
        entity({ slug: 'center-b', name: 'Brain Institute', entityType: 'INSTITUTE' }),
        entity({ slug: 'prog-c', name: 'Summer Neuro RA', entityType: 'RA_PROGRAM' }),
        entity({ slug: 'coll-d', name: 'Anatomy Collection', entityType: 'COLLECTIONS_INITIATIVE' }),
      ],
      new Map(),
    );

    expect(page.buckets.map((bucket) => bucket.key)).toEqual([
      'labs',
      'centers',
      'programs',
      'collections',
    ]);
    expect(page.buckets[0].label).toBe('Research groups & labs');
    expect(page.totalCount).toBe(4);
  });

  it('surfaces documented ways in as a cross-cut of the same footprint', () => {
    const page = buildAreaResearchPage(
      areaScope,
      [
        entity({ slug: 'lab-open', name: 'Open Lab', entityType: 'LAB' }),
        entity({ slug: 'lab-quiet', name: 'Quiet Lab', entityType: 'LAB' }),
        entity({ slug: 'prog-apply', name: 'Neuro Fellowship', entityType: 'FELLOWSHIP_PROGRAM' }),
      ],
      new Map([
        ['lab-open', summary('posted-opening')],
        ['prog-apply', summary('evidence-backed')],
        ['lab-quiet', summary('reach-out-plausible')],
      ]),
    );

    expect(page.totalCount).toBe(3);
    expect(page.waysIn.totalCount).toBe(2);
    expect(page.waysIn.researchEntities.map((e) => e.slug).sort()).toEqual([
      'lab-open',
      'prog-apply',
    ]);
    const openHome = page.waysIn.researchEntities.find((e) => e.slug === 'lab-open');
    expect((openHome?.accessSummary as AccessSummary | undefined)?.status).toBe('posted-opening');
  });

  it('caps entities per bucket while reporting the true total', () => {
    const many = Array.from({ length: 75 }, (_, index) =>
      entity({ slug: `lab-${index}`, name: `Lab ${String(index).padStart(3, '0')}` }),
    );
    const page = buildAreaResearchPage(areaScope, many, new Map());
    expect(page.totalCount).toBe(75);
    expect(page.buckets[0].totalCount).toBe(75);
    expect(page.buckets[0].researchEntities.length).toBe(60);
  });

  it('routes an unknown entity type into the other bucket', () => {
    const page = buildAreaResearchPage(
      areaScope,
      [entity({ slug: 'odd', name: 'Odd Thing', entityType: 'MYSTERY_TYPE' })],
      new Map(),
    );
    expect(page.buckets.map((bucket) => bucket.key)).toEqual(['other']);
    expect(page.buckets[0].label).toBe('Other research homes');
  });
});
