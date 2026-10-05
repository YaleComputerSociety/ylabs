import { describe, expect, it } from 'vitest';
import { planRefusedStoredDescriptionClears } from '../refusedStoredDescription';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const BODY = 'The Fixture Lab studies how metabolic pathways are regulated in disease.';
const CARD = 'The Fixture Lab studies metabolic disease.';

const refusal = (field: string, value: string, overrides: Record<string, unknown> = {}) => ({
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'superseded_by_better_source',
  refusedBy: 'test',
  refusedAt: new Date(),
  note: '',
  ...overrides,
});

const plan = (
  overrides: Partial<Parameters<typeof planRefusedStoredDescriptionClears>[0]> = {},
): ReturnType<typeof planRefusedStoredDescriptionClears> =>
  planRefusedStoredDescriptionClears({ stored: {}, lockedFields: [], ...overrides });

const fields = (result: ReturnType<typeof planRefusedStoredDescriptionClears>): string[] =>
  result.filter((entry) => !entry.skipped).map((entry) => entry.field);

describe('planRefusedStoredDescriptionClears', () => {
  it('clears a stored body the row refuses', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', BODY)] },
      },
    });

    expect(fields(result)).toEqual(['fullDescription']);
  });

  it('clears both fields when both stored values are refused', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        shortDescription: CARD,
        fieldValueRefusals: {
          fullDescription: [refusal('fullDescription', BODY)],
          shortDescription: [refusal('shortDescription', CARD)],
        },
      },
    });

    expect(fields(result)).toEqual(['fullDescription', 'shortDescription']);
  });

  it('leaves a stored value the row does not refuse alone', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', 'something else')] },
      },
    });

    expect(result).toEqual([]);
  });

  it('plans nothing on a row with no refusals at all', () => {
    expect(plan({ stored: { fullDescription: BODY } })).toEqual([]);
    expect(plan({ stored: null })).toEqual([]);
  });

  it('ignores a withdrawn refusal, because a withdrawn record is history rather than a rule', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: {
          fullDescription: [refusal('fullDescription', BODY, { withdrawnAt: new Date() })],
        },
      },
    });

    expect(result).toEqual([]);
  });

  it('reports a refused value on a locked field instead of clearing it', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', BODY)] },
      },
      lockedFields: ['fullDescription'],
    });

    expect(result).toEqual([{ field: 'fullDescription', skipped: 'field-is-locked' }]);
  });

  it('reads the staged value over the stored one, so an unrefused staged value survives', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', BODY)] },
      },
      staged: { fullDescription: 'A body this row has never refused.' },
    });

    expect(result).toEqual([]);
  });

  it('reads the staged value over the stored one, so a refused staged value is cleared', () => {
    const result = plan({
      stored: {
        fullDescription: 'A body this row has never refused.',
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', BODY)] },
      },
      staged: { fullDescription: BODY },
    });

    expect(fields(result)).toEqual(['fullDescription']);
  });

  it('matches on the refusal key rather than on the exact string, so whitespace cannot evade it', () => {
    const result = plan({
      stored: {
        fullDescription: `  ${BODY.toUpperCase().replace(' ', '\n  ')}  `,
        fieldValueRefusals: { fullDescription: [refusal('fullDescription', BODY)] },
      },
    });

    expect(fields(result)).toEqual(['fullDescription']);
  });

  it('is idempotent: a second pass over its own output plans nothing', () => {
    const refusals = { fullDescription: [refusal('fullDescription', BODY)] };
    expect(
      fields(plan({ stored: { fullDescription: BODY, fieldValueRefusals: refusals } })),
    ).toEqual(['fullDescription']);
    expect(plan({ stored: { fullDescription: '', fieldValueRefusals: refusals } })).toEqual([]);
  });

  it('reaches a Mongoose Map of refusals as well as a plain object', () => {
    const result = plan({
      stored: {
        fullDescription: BODY,
        fieldValueRefusals: new Map([['fullDescription', [refusal('fullDescription', BODY)]]]),
      },
    });

    expect(fields(result)).toEqual(['fullDescription']);
  });
});
