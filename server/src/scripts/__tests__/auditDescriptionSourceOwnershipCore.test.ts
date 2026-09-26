import { describe, expect, it } from 'vitest';
import {
  buildDescriptionSourceOwnershipReport,
  classifyDescriptionSourceOwnership,
} from '../auditDescriptionSourceOwnershipCore';

const SHARED = new Set(['https://medicine.yale.edu/research']);
const INSTITUTIONAL = new Set(['medicine.yale.edu']);
const OWN = new Set<string>();
const NO_HOSTS = new Set<string>();

const row = (over: Record<string, unknown> = {}) => ({
  slug: 'a-row',
  entityType: 'FACULTY_RESEARCH_AREA',
  fullDescription: 'Studies protein folding using cryo-electron microscopy.',
  fieldProvenance: {
    fullDescription: {
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://proberlab.yale.edu/',
      observedAt: '2026-09-01T00:00:00.000Z',
    },
  },
  ...over,
});

describe('classifyDescriptionSourceOwnership', () => {
  it('accepts a page only this row cites', () => {
    expect(classifyDescriptionSourceOwnership(row(), OWN, NO_HOSTS).verdict).toBe('owned');
  });

  it('refuses a page more than one row cites', () => {
    const finding = classifyDescriptionSourceOwnership(
      row({
        fieldProvenance: {
          fullDescription: { sourceUrl: 'https://medicine.yale.edu/research', sourceName: 'x' },
        },
      }),
      SHARED,
      NO_HOSTS,
    );
    expect(finding.verdict).toBe('shared_evidence_page');
  });

  it('refuses an institutional section landing page even when only one row cites it', () => {
    const finding = classifyDescriptionSourceOwnership(
      row({
        fieldProvenance: {
          fullDescription: { sourceUrl: 'https://medicine.yale.edu/research', sourceName: 'x' },
        },
      }),
      OWN,
      INSTITUTIONAL,
    );
    expect(finding.verdict).toBe('institution_section_landing');
  });

  it("exempts a person's own profile, which their lab row and research row both cite", () => {
    const finding = classifyDescriptionSourceOwnership(
      row({
        fieldProvenance: {
          fullDescription: {
            sourceUrl: 'https://medicine.yale.edu/profile/robin-hansen/',
            sourceName: 'x',
          },
        },
      }),
      new Set(['https://medicine.yale.edu/profile/robin-hansen']),
      NO_HOSTS,
    );
    expect(finding.verdict).toBe('owned');
  });

  it('separates a row with no description from a row with no cited page', () => {
    expect(
      classifyDescriptionSourceOwnership(row({ fullDescription: '' }), OWN, NO_HOSTS).verdict,
    ).toBe('no_description');
    expect(
      classifyDescriptionSourceOwnership(row({ fieldProvenance: {} }), OWN, NO_HOSTS).verdict,
    ).toBe('no_cited_page');
  });

  it('reports how many rows cite the page, so a pair reads differently from a directory', () => {
    const citers = new Map([['https://medicine.yale.edu/research', 20]]);
    const finding = classifyDescriptionSourceOwnership(
      row({
        fieldProvenance: {
          fullDescription: { sourceUrl: 'https://medicine.yale.edu/research', sourceName: 'x' },
        },
      }),
      SHARED,
      NO_HOSTS,
      citers,
    );
    expect(finding.citedPageRowCount).toBe(20);
  });
});

describe('buildDescriptionSourceOwnershipReport', () => {
  it('splits the unowned rows by whether the write predates the #3162 guard', () => {
    const report = buildDescriptionSourceOwnershipReport([
      {
        slug: 'before',
        entityType: 'LAB',
        verdict: 'shared_evidence_page',
        citedUrl: 'https://u/1',
        lane: 'lane-a',
        observedAt: '2026-09-01T00:00:00.000Z',
        descriptionHead: '',
        citedPageRowCount: 4,
      },
      {
        slug: 'after',
        entityType: 'LAB',
        verdict: 'shared_evidence_page',
        citedUrl: 'https://u/1',
        lane: 'lane-b',
        observedAt: '2026-09-30T00:00:00.000Z',
        descriptionHead: '',
        citedPageRowCount: 4,
      },
      {
        slug: 'fine',
        entityType: 'LAB',
        verdict: 'owned',
        citedUrl: 'https://u/2',
        lane: 'lane-a',
        observedAt: '2026-09-30T00:00:00.000Z',
        descriptionHead: '',
        citedPageRowCount: 1,
      },
    ]);
    expect(report.unownedBeforeGuard).toBe(1);
    expect(report.unownedAfterGuard).toBe(1);
    expect(report.byVerdict.owned).toBe(1);
    expect(report.byLane).toEqual({ 'lane-a': 1, 'lane-b': 1 });
    expect(report.reusedCitedUrls).toEqual([{ url: 'https://u/1', rows: 2 }]);
  });

  it('counts an owned row in no lane bucket, so a lane total means defects only', () => {
    const report = buildDescriptionSourceOwnershipReport([
      {
        slug: 'fine',
        entityType: 'LAB',
        verdict: 'owned',
        citedUrl: 'https://u/2',
        lane: 'busy-lane',
        observedAt: '2026-09-30T00:00:00.000Z',
        descriptionHead: '',
        citedPageRowCount: 1,
      },
    ]);
    expect(report.byLane).toEqual({});
  });
});
