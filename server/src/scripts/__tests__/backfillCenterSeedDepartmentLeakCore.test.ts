import { describe, expect, it } from 'vitest';
import {
  expandLeakedSeedForms,
  normalizeDeptToken,
  stripUncorroboratedLeak,
} from '../backfillCenterSeedDepartmentLeakCore';

const WTI_SEED = ['Neuroscience', 'Psychology', 'Molecular, Cellular and Developmental Biology'];

describe('normalizeDeptToken', () => {
  it('is comma- and case-insensitive so both MCDB comma variants collapse', () => {
    expect(normalizeDeptToken('Molecular, Cellular and Developmental Biology')).toBe(
      normalizeDeptToken('Molecular, Cellular, and Developmental Biology'),
    );
  });
});

describe('expandLeakedSeedForms', () => {
  it('adds the shortened "Developmental Biology" research-area chip form for the MCDB seed', () => {
    const forms = expandLeakedSeedForms(WTI_SEED);
    expect(forms).toContain('Developmental Biology');
    expect(forms).toContain('Neuroscience');
    expect(forms).toContain('Molecular, Cellular and Developmental Biology');
  });

  it('drops empties and does not add the short form for unrelated seeds', () => {
    expect(expandLeakedSeedForms(['Physics', '', '  '])).toEqual(['Physics']);
  });
});

describe('stripUncorroboratedLeak', () => {
  it('removes seeded values not corroborated by the member own observations', () => {
    const result = stripUncorroboratedLeak({
      current: ['Computer Science', 'Neuroscience', 'Psychology', 'Molecular, Cellular, and Developmental Biology'],
      ownObserved: ['Computer Science'],
      leaked: expandLeakedSeedForms(WTI_SEED),
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['Computer Science']);
    expect(result.removed).toEqual([
      'Neuroscience',
      'Psychology',
      'Molecular, Cellular, and Developmental Biology',
    ]);
  });

  it('keeps a seeded value when the member own source independently asserts it', () => {
    const result = stripUncorroboratedLeak({
      current: ['Neuroscience', 'Psychology', 'Molecular, Cellular, and Developmental Biology'],
      ownObserved: ['Neuroscience'],
      leaked: expandLeakedSeedForms(WTI_SEED),
    });
    expect(result.cleaned).toEqual(['Neuroscience']);
    expect(result.removed).toEqual(['Psychology', 'Molecular, Cellular, and Developmental Biology']);
  });

  it('collapses a pure faculty-research-area stub to an empty list', () => {
    const result = stripUncorroboratedLeak({
      current: ['Neuroscience', 'Psychology', 'Molecular, Cellular, and Developmental Biology'],
      ownObserved: [],
      leaked: expandLeakedSeedForms(WTI_SEED),
    });
    expect(result.cleaned).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('strips the shortened Developmental Biology research-area chip too', () => {
    const result = stripUncorroboratedLeak({
      current: ['Linguistics', 'Neuroscience', 'Psychology', 'Speech Recognition', 'Developmental Biology'],
      ownObserved: ['Linguistics', 'Speech Recognition'],
      leaked: expandLeakedSeedForms(WTI_SEED),
    });
    expect(result.cleaned).toEqual(['Linguistics', 'Speech Recognition']);
  });

  it('leaves an unaffected entity unchanged', () => {
    const result = stripUncorroboratedLeak({
      current: ['Economics', 'Statistics'],
      ownObserved: ['Economics', 'Statistics'],
      leaked: expandLeakedSeedForms(WTI_SEED),
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual(['Economics', 'Statistics']);
    expect(result.removed).toEqual([]);
  });
});
