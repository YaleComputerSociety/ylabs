import { describe, expect, it } from 'vitest';
import {
  PR_1325_MERGED_AT,
  isContaminatedUndergradEvidenceQuote,
  isLegacyCurrentUndergradCountObservation,
  parseBackfill1372Args,
  selectBackfillTargetSlugs,
  selectContaminatedEvidenceQuoteObservations,
} from '../backfill1372UndergradCountRescrapeCore';

describe('isLegacyCurrentUndergradCountObservation', () => {
  it('flags observations recorded before the #1325 merge as legacy', () => {
    const before = new Date(PR_1325_MERGED_AT.getTime() - 1000);
    expect(isLegacyCurrentUndergradCountObservation(before)).toBe(true);
  });

  it('does not flag observations recorded at or after the #1325 merge', () => {
    expect(isLegacyCurrentUndergradCountObservation(PR_1325_MERGED_AT)).toBe(false);
    const after = new Date(PR_1325_MERGED_AT.getTime() + 1000);
    expect(isLegacyCurrentUndergradCountObservation(after)).toBe(false);
  });

  it('is false for missing or invalid timestamps', () => {
    expect(isLegacyCurrentUndergradCountObservation(undefined)).toBe(false);
    expect(isLegacyCurrentUndergradCountObservation('not-a-date')).toBe(false);
  });
});

describe('selectBackfillTargetSlugs', () => {
  it('targets legacy slugs with a positive stored count', () => {
    const targets = selectBackfillTargetSlugs(['lab-a', 'lab-b'], [
      { slug: 'lab-a', currentUndergradCount: 5 },
      { slug: 'lab-b', currentUndergradCount: 0 },
    ]);
    expect(targets).toEqual(['lab-a']);
  });

  it('excludes entities that manually locked currentUndergradCount', () => {
    const targets = selectBackfillTargetSlugs(['lab-a'], [
      { slug: 'lab-a', currentUndergradCount: 5, manuallyLockedFields: ['currentUndergradCount'] },
    ]);
    expect(targets).toEqual([]);
  });

  it('excludes legacy slugs no longer present in the entity list', () => {
    const targets = selectBackfillTargetSlugs(['lab-a', 'lab-missing'], [
      { slug: 'lab-a', currentUndergradCount: 3 },
    ]);
    expect(targets).toEqual(['lab-a']);
  });
});

describe('isContaminatedUndergradEvidenceQuote', () => {
  it('flags a historical alumnus quote (#1372)', () => {
    expect(
      isContaminatedUndergradEvidenceQuote(
        'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford',
      ),
    ).toBe(true);
  });

  it('flags a non-Yale visiting undergrad quote (#1372)', () => {
    expect(isContaminatedUndergradEvidenceQuote('Young Lin, undergraduate, Emory University')).toBe(true);
  });

  it('flags a closed date-range quote (#1372)', () => {
    expect(isContaminatedUndergradEvidenceQuote('Sumedha Chowdhury, Undergrad Research Assistant (2021-2023)')).toBe(
      true,
    );
  });

  it('does not flag a current Yale undergrad quote', () => {
    expect(isContaminatedUndergradEvidenceQuote('Jane Doe is a junior at Yale College majoring in Physics.')).toBe(
      false,
    );
  });

  it('is false for empty or non-string values', () => {
    expect(isContaminatedUndergradEvidenceQuote(undefined)).toBe(false);
    expect(isContaminatedUndergradEvidenceQuote('')).toBe(false);
    expect(isContaminatedUndergradEvidenceQuote(42)).toBe(false);
  });
});

describe('selectContaminatedEvidenceQuoteObservations', () => {
  it('returns only the observations whose quote is contaminated', () => {
    const selected = selectContaminatedEvidenceQuoteObservations([
      { id: 'a', entityKey: 'lab-a', value: 'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford' },
      { id: 'b', entityKey: 'lab-b', value: 'Jane Doe is a junior at Yale College majoring in Physics.' },
    ]);
    expect(selected.map((obs) => obs.id)).toEqual(['a']);
  });
});

describe('parseBackfill1372Args', () => {
  it('defaults to dry-run with no slugs override', () => {
    expect(parseBackfill1372Args([])).toEqual({ apply: false });
  });

  it('parses --apply, --slugs, and --output', () => {
    expect(parseBackfill1372Args(['--apply', '--slugs', 'a,b, c', '--output', '/tmp/report.json'])).toEqual({
      apply: true,
      slugs: ['a', 'b', 'c'],
      output: '/tmp/report.json',
    });
  });

  it('rejects unknown flags', () => {
    expect(() => parseBackfill1372Args(['--bogus'])).toThrow(/Unknown backfill-1372 argument/);
  });
});
