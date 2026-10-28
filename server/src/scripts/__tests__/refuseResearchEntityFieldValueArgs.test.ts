import { describe, expect, it } from 'vitest';
import {
  assertRefuseFieldValueArgs,
  parseRefuseFieldValueArgs,
} from '../refuseResearchEntityFieldValue';

describe('naming a stored list of records to refuse (#5433)', () => {
  it('reads --value-json as the stored value', () => {
    const args = parseRefuseFieldValueArgs([
      '--slug=fixture-lab',
      '--field=pastUndergradAdvisees',
      '--value-json=[{"count":1,"programName":"Lab roster alumni","year":null}]',
      '--rule=operator_judgement',
      '--note=the cited page names no undergraduate',
      '--decided-by=fixture owner',
    ]);
    expect(args.value).toEqual([{ count: 1, programName: 'Lab roster alumni', year: null }]);
    expect(() => assertRefuseFieldValueArgs(args)).not.toThrow();
  });

  it('refuses malformed JSON rather than storing it as text', () => {
    expect(() => parseRefuseFieldValueArgs(['--value-json=[{'])).toThrow(/valid JSON/);
  });
});
