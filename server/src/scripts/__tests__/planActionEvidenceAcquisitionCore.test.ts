import { describe, expect, it } from 'vitest';

import {
  ACTION_EVIDENCE_ACQUISITION_SOURCE,
  buildAcquisitionCommand,
  isSoleActionEvidenceBlocker,
  planAcquisitionBatches,
  selectActionEvidenceAcquisitionTargets,
  type ActionEvidenceLabRow,
} from '../planActionEvidenceAcquisitionCore';

const lab = (overrides: Partial<ActionEvidenceLabRow>): ActionEvidenceLabRow => ({
  slug: overrides.slug ?? 'example-lab',
  name: overrides.name ?? 'Example Lab',
  website: overrides.website ?? 'https://example-lab.yale.edu/',
  reasons: overrides.reasons ?? ['source_backed_description', 'missing_action_evidence'],
  lastObservedAt: overrides.lastObservedAt ?? null,
});

describe('isSoleActionEvidenceBlocker', () => {
  it('accepts a record whose only blocker is missing_action_evidence', () => {
    expect(
      isSoleActionEvidenceBlocker(['source_backed_description', 'missing_action_evidence']),
    ).toBe(true);
  });

  it('rejects records with an additional blocking reason', () => {
    expect(
      isSoleActionEvidenceBlocker([
        'missing_action_evidence',
        'missing_card_description',
        'source_backed_description',
      ]),
    ).toBe(false);
  });

  it('rejects records without missing_action_evidence', () => {
    expect(isSoleActionEvidenceBlocker(['source_backed_description', 'concrete_next_step'])).toBe(
      false,
    );
  });
});

describe('selectActionEvidenceAcquisitionTargets', () => {
  it('keeps sole-blocker labs with an uncovered website and orders stale-first', () => {
    const targets = selectActionEvidenceAcquisitionTargets([
      lab({ slug: 'fresh', lastObservedAt: '2026-08-01T00:00:00.000Z' }),
      lab({ slug: 'stale', lastObservedAt: '2026-01-01T00:00:00.000Z' }),
      lab({ slug: 'never', lastObservedAt: null }),
    ]);
    expect(targets.map((row) => row.slug)).toEqual(['never', 'stale', 'fresh']);
  });

  it('excludes already-covered medicine.yale.edu hosts', () => {
    const targets = selectActionEvidenceAcquisitionTargets([
      lab({ slug: 'covered', website: 'https://medicine.yale.edu/lab/example/' }),
      lab({ slug: 'uncovered', website: 'https://example-lab.yale.edu/' }),
    ]);
    expect(targets.map((row) => row.slug)).toEqual(['uncovered']);
  });

  it('drops labs without a usable http website', () => {
    const targets = selectActionEvidenceAcquisitionTargets([lab({ slug: 'no-web', website: '' })]);
    expect(targets).toHaveLength(0);
  });

  it('skips funding-record hosts that are not lab sites', () => {
    const targets = selectActionEvidenceAcquisitionTargets([
      lab({ slug: 'nih-grant', website: 'https://reporter.nih.gov/project-details/123' }),
      lab({ slug: 'nsf-grant', website: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1' }),
      lab({ slug: 'real-lab', website: 'https://real-lab.yale.edu/' }),
    ]);
    expect(targets.map((row) => row.slug)).toEqual(['real-lab']);
  });
});

describe('planAcquisitionBatches', () => {
  it('chunks slugs by the batch size', () => {
    const targets = Array.from({ length: 5 }, (_unused, index) => lab({ slug: `lab-${index}` }));
    expect(planAcquisitionBatches(targets, 2)).toEqual([
      ['lab-0', 'lab-1'],
      ['lab-2', 'lab-3'],
      ['lab-4'],
    ]);
  });
});

describe('buildAcquisitionCommand', () => {
  it('targets the acquisition source with a comma-joined allowlist', () => {
    const command = buildAcquisitionCommand(['a', 'b']);
    expect(command).toContain(`--source ${ACTION_EVIDENCE_ACQUISITION_SOURCE}`);
    expect(command).toContain('--only a,b');
  });
});
