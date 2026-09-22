import { describe, expect, it } from 'vitest';
import {
  accumulateChipRepairCounts,
  emptyChipRepairCounts,
  planChipList,
} from '../repairSentenceShapedChipsCore';

describe('planChipList', () => {
  it('trims a stray stop and keeps the topic', () => {
    const plan = planChipList('researchAreas', [
      'Global Health',
      'Polymorphic Drug Metabolizing Enzymes.',
    ]);
    expect(plan.repaired).toEqual(['Global Health', 'Polymorphic Drug Metabolizing Enzymes']);
    expect(plan.refused).toEqual([]);
    expect(plan.trimmed).toEqual([
      {
        before: 'Polymorphic Drug Metabolizing Enzymes.',
        after: 'Polymorphic Drug Metabolizing Enzymes',
      },
    ]);
    expect(plan.changed).toBe(true);
  });

  it('keeps an abbreviation-ending chip exactly as stored', () => {
    const plan = planChipList('researchAreas', [
      'Centers for Disease Control and Prevention, U.S.',
      'Roster et al.',
    ]);
    expect(plan.repaired).toEqual([
      'Centers for Disease Control and Prevention, U.S.',
      'Roster et al.',
    ]);
    expect(plan.changed).toBe(false);
  });

  it('refuses a sentence captured as a method chip and keeps the rest', () => {
    const plan = planChipList('methods', [
      'Bisulfite seq.',
      'Providing, or arranging for, other kinds of data collection.',
    ]);
    expect(plan.repaired).toEqual(['Bisulfite seq.']);
    expect(plan.refused).toEqual(['Providing, or arranging for, other kinds of data collection.']);
    expect(plan.changed).toBe(true);
  });

  it('plans nothing on a clean list or a non-array', () => {
    expect(planChipList('researchAreas', ['Immunology', 'Global Health']).changed).toBe(false);
    expect(planChipList('methods', undefined).changed).toBe(false);
  });

  it('is idempotent, so a re-run over a repaired list plans nothing', () => {
    const first = planChipList('researchAreas', ['Concentration.']);
    expect(first.changed).toBe(true);
    expect(planChipList('researchAreas', first.repaired).changed).toBe(false);
  });

  it('reports an emptied list so the caller can unset the field', () => {
    const plan = planChipList('methods', [
      'Explore barriers and facilitators to quality care for patients with Limited English Proficiency in the US.',
    ]);
    expect(plan.repaired).toEqual([]);
    expect(plan.refused).toHaveLength(1);
  });
});

describe('accumulateChipRepairCounts', () => {
  it('counts refusals, trims, changed lists, and emptied lists separately', () => {
    const counts = emptyChipRepairCounts();
    accumulateChipRepairCounts(
      counts,
      planChipList('researchAreas', ['Concentration.', 'Global Health']),
    );
    accumulateChipRepairCounts(
      counts,
      planChipList('methods', ['Providing, or arranging for, other kinds of data collection.']),
    );
    expect(counts).toEqual({
      chipsRefused: 1,
      chipsTrimmed: 1,
      listsChanged: 2,
      listsEmptied: 1,
    });
  });

  it('counts nothing for an unchanged list', () => {
    const counts = emptyChipRepairCounts();
    accumulateChipRepairCounts(counts, planChipList('researchAreas', ['Immunology']));
    expect(counts).toEqual(emptyChipRepairCounts());
  });
});
