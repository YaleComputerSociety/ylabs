/**
 * The selector exists to answer one question - would a re-resolution give a student
 * text where there is none - so both directions are pinned: it must find a fill, and
 * it must never propose a row whose served copy the pass would remove. The second is
 * what keeps a delivery pass from becoming the corpus-wide churn #3332 warns about.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyFrozenDescription,
  deliverableSlugs,
  summarizeFrozenDescriptions,
  type FrozenDescriptionFinding,
} from '../auditFrozenDescriptionsCore';

const base = {
  slug: 'dept-fictional-studies-robin-roster',
  field: 'shortDescription' as const,
  tier: 'student_ready',
  liveObservationCount: 2,
  projectionNamesField: true,
};

describe('classifyFrozenDescription', () => {
  it('reads an empty served field the projection would fill as a served fill', () => {
    expect(
      classifyFrozenDescription({
        ...base,
        servedBefore: '',
        servedAfter: 'Studies fictional states.',
      }).verdict,
    ).toBe('served_fill');
  });

  it('reads whitespace as empty, so a blank card is not mistaken for copy', () => {
    expect(
      classifyFrozenDescription({
        ...base,
        servedBefore: '   ',
        servedAfter: 'Studies fictional states.',
      }).verdict,
    ).toBe('served_fill');
  });

  it('separates a regression from a lateral rewrite, because only one is a reason to stop', () => {
    expect(
      classifyFrozenDescription({
        ...base,
        servedBefore: 'Studies fictional states.',
        servedAfter: '',
      }).verdict,
    ).toBe('served_regress');
    expect(
      classifyFrozenDescription({
        ...base,
        servedBefore: 'Studies fictional states.',
        servedAfter: 'Studies elections in fictional states.',
      }).verdict,
    ).toBe('served_lateral');
  });

  it('reads an identical value as already delivered', () => {
    expect(
      classifyFrozenDescription({
        ...base,
        servedBefore: 'Studies fictional states.',
        servedAfter: 'Studies fictional states.',
      }).verdict,
    ).toBe('served_unchanged');
  });

  // A projection that says nothing about the field is not agreement: the stored value
  // stands because nothing was planned, which is a different fact from a match.
  it('reads a silent projection as silence rather than as no change', () => {
    expect(
      classifyFrozenDescription({
        ...base,
        projectionNamesField: false,
        servedBefore: '',
        servedAfter: '',
      }).verdict,
    ).toBe('projection_silent');
  });
});

describe('deliverableSlugs', () => {
  const finding = (
    slug: string,
    verdict: FrozenDescriptionFinding['verdict'],
    field: FrozenDescriptionFinding['field'] = 'shortDescription',
  ): FrozenDescriptionFinding => ({
    ...base,
    slug,
    field,
    verdict,
    servedBefore: '',
    servedAfter: '',
  });

  it('offers a row with a fill', () => {
    expect(deliverableSlugs([finding('row-a', 'served_fill')])).toEqual(['row-a']);
  });

  // `research-entity:rematerialize` writes a field closure rather than one field, so a
  // row that would lose served copy on any field cannot be delivered for the other.
  it('withholds a row that would lose served copy on any field', () => {
    expect(
      deliverableSlugs([
        finding('row-a', 'served_fill', 'shortDescription'),
        finding('row-a', 'served_regress', 'fullDescription'),
      ]),
    ).toEqual([]);
  });

  it('offers nothing for a lateral rewrite, which needs a per-row argument', () => {
    expect(deliverableSlugs([finding('row-a', 'served_lateral')])).toEqual([]);
  });
});

describe('summarizeFrozenDescriptions', () => {
  it('counts fills per field and per tier, and rows once', () => {
    const summary = summarizeFrozenDescriptions([
      {
        ...base,
        slug: 'row-a',
        field: 'shortDescription',
        verdict: 'served_fill',
        servedBefore: '',
        servedAfter: 'x',
      },
      {
        ...base,
        slug: 'row-a',
        field: 'fullDescription',
        verdict: 'served_unchanged',
        servedBefore: 'y',
        servedAfter: 'y',
      },
      {
        ...base,
        slug: 'row-b',
        field: 'fullDescription',
        tier: 'operator_review',
        verdict: 'served_fill',
        servedBefore: '',
        servedAfter: 'z',
      },
    ]);

    expect(summary.rowsProbed).toBe(2);
    expect(summary.byVerdict).toEqual({ served_fill: 2, served_unchanged: 1 });
    expect(summary.servedFillsByField).toEqual({ shortDescription: 1, fullDescription: 1 });
    expect(summary.studentReadyServedFills).toBe(1);
    expect(summary.deliverableRows).toBe(2);
  });
});
