import { describe, expect, it } from 'vitest';
import {
  assertServedCardResidualAuditConsistent,
  buildServedCardResidualAudit,
  chipCardTemplateItems,
  servedBodyGluesASentenceBoundary,
  servedCardNamesDroppedChip,
  servedCardResidualClasses,
  servedCopyLeaksTheSelfReferenceNoun,
  type ServedCardResidualRow,
} from '../servedCardResidualAuditCore';

const row = (overrides: Partial<ServedCardResidualRow> = {}): ServedCardResidualRow => ({
  slug: 'a-row',
  shortDescription: 'Investigates how immune cells decide.',
  fullDescription: 'This research investigates how immune cells decide. It uses live imaging.',
  researchAreas: ['Immunology'],
  ...overrides,
});

describe('chipCardTemplateItems', () => {
  it('splits the chip-summary template into its named chips', () => {
    expect(chipCardTemplateItems('Studies Ecology, Physics, and Chemistry.')).toEqual([
      'Ecology',
      'Physics',
      'Chemistry',
    ]);
    expect(chipCardTemplateItems('Studies Physics.')).toEqual(['Physics']);
  });

  it('does not treat real prose as the template', () => {
    expect(chipCardTemplateItems('Studies how immune cells decide, using live imaging.')).toEqual([
      'how immune cells decide',
      'using live imaging',
    ]);
    expect(chipCardTemplateItems('Investigates how immune cells decide.')).toEqual([]);
  });
});

describe('servedCardNamesDroppedChip', () => {
  it('fires when the card names a chip the served row no longer carries', () => {
    expect(
      servedCardNamesDroppedChip(
        row({
          shortDescription: 'Studies Artificial Intelligence and Ecology.',
          researchAreas: ['Ecology'],
        }),
      ),
    ).toBe(true);
  });

  it('stays quiet when every named chip is still served', () => {
    expect(
      servedCardNamesDroppedChip(
        row({
          shortDescription: 'Studies Ecology and Physics.',
          researchAreas: ['ecology', 'Physics'],
        }),
      ),
    ).toBe(false);
  });

  it('stays quiet on prose that merely opens with the template verb', () => {
    expect(
      servedCardNamesDroppedChip(
        row({ shortDescription: 'Studies colonial and imperial cities.', researchAreas: [] }),
      ),
    ).toBe(false);
  });

  it('stays quiet on a card that is not the chip template', () => {
    expect(servedCardNamesDroppedChip(row({ researchAreas: [] }))).toBe(false);
  });
});

describe('servedBodyGluesASentenceBoundary', () => {
  it('fires on a lost space after a sentence-ending period', () => {
    expect(
      servedBodyGluesASentenceBoundary('glycemic control in the critically ill.Dr. Maerz earned'),
    ).toBe(true);
  });

  it('does not fire on a sentence boundary that kept its space', () => {
    expect(servedBodyGluesASentenceBoundary('One sentence. Another sentence.')).toBe(false);
  });

  it('does not fire on an abbreviation that legitimately precedes a capital', () => {
    expect(servedBodyGluesASentenceBoundary('reported by Smith et al.Later work extended it')).toBe(
      false,
    );
  });
});

describe('servedCopyLeaksTheSelfReferenceNoun', () => {
  it('fires when the served card keeps the relabel pass output', () => {
    expect(
      servedCopyLeaksTheSelfReferenceNoun(
        row({ shortDescription: 'This research profile builds trustworthy systems.' }),
      ),
    ).toBe(true);
  });

  it('stays quiet on copy the sanitizer rewrote', () => {
    expect(
      servedCopyLeaksTheSelfReferenceNoun(
        row({ shortDescription: 'This research builds trustworthy systems.' }),
      ),
    ).toBe(false);
  });
});

describe('servedCardResidualClasses', () => {
  it('reports an empty card', () => {
    expect(servedCardResidualClasses(row({ shortDescription: '   ' }))).toContain('empty_card');
  });

  it('reports nothing on clean served copy', () => {
    expect(servedCardResidualClasses(row())).toEqual([]);
  });
});

describe('buildServedCardResidualAudit', () => {
  it('counts each class and keeps its slug list in step', () => {
    const audit = buildServedCardResidualAudit([
      row({ slug: 'clean-row' }),
      row({ slug: 'empty-card-row', shortDescription: '' }),
      row({
        slug: 'stale-chip-row',
        shortDescription: 'Studies Artificial Intelligence and Ecology.',
        researchAreas: ['Ecology'],
      }),
    ]);

    expect(audit.servedRows).toBe(3);
    expect(audit.counts.empty_card).toBe(1);
    expect(audit.counts.stale_chip_card).toBe(1);
    expect(audit.slugs.stale_chip_card).toEqual(['stale-chip-row']);
    expect(() => assertServedCardResidualAuditConsistent(audit)).not.toThrow();
  });

  it('refuses an empty population rather than reporting a clean corpus', () => {
    expect(() => assertServedCardResidualAuditConsistent(buildServedCardResidualAudit([]))).toThrow(
      /broken route or a broken audit/,
    );
  });
});
