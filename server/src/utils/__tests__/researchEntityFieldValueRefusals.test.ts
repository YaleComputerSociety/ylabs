/**
 * A refusal has to do two opposite things, so both directions are pinned here: it
 * must keep a wrong value out, and it must not keep a good one out (#3167). The
 * second is the one that would turn it back into `manuallyLockedFields` with extra
 * steps.
 */
import { describe, expect, it } from 'vitest';
import {
  fieldValueRefusalKey,
  fieldValueRefusalsPath,
  foldDefaultDocumentLeaf,
  liveFieldValueRefusals,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
  refusedResolverObservations,
  refusedValueRule,
  valueIsRefused,
} from '../researchEntityFieldValueRefusals';

const WRONG = 'https://journals.example.org/doi/10.1177/000000';
const RIGHT = 'https://fixturelab.org/';

const rowRefusing = (value: string = WRONG) => ({
  fieldValueRefusals: {
    websiteUrl: [
      {
        valueKey: fieldValueRefusalKey('websiteUrl', value),
        rule: 'not_this_rows_research' as const,
        refusedBy: 'test',
        refusedAt: new Date('2026-09-01T00:00:00Z'),
        note: '',
      },
    ],
  },
});

describe('a refusal keeps the refused value out', () => {
  it('matches the value it was recorded against', () => {
    expect(valueIsRefused(rowRefusing().fieldValueRefusals, 'websiteUrl', WRONG)).toBe(true);
    expect(refusedValueRule(rowRefusing().fieldValueRefusals, 'websiteUrl', WRONG)).toBe(
      'not_this_rows_research',
    );
  });

  it('matches another spelling of the same page, since a URL has many', () => {
    const refusals = rowRefusing(
      'https://journals.example.org/doi/10.1177/000000/',
    ).fieldValueRefusals;

    expect(
      valueIsRefused(refusals, 'websiteUrl', 'http://journals.example.org/doi/10.1177/000000'),
    ).toBe(true);
  });

  it('drops only the refused observation, leaving the rest to resolve', () => {
    const screened = refusedResolverObservations(
      [
        { field: 'websiteUrl', value: WRONG },
        { field: 'websiteUrl', value: RIGHT },
        { field: 'name', value: 'Fixture Lab' },
      ],
      rowRefusing().fieldValueRefusals,
    );

    expect(screened.kept).toEqual([
      { field: 'websiteUrl', value: RIGHT },
      { field: 'name', value: 'Fixture Lab' },
    ]);
    expect(screened.refused).toEqual([{ field: 'websiteUrl', rule: 'not_this_rows_research' }]);
  });

  it('leaves the field with no candidate when every rival is refused', () => {
    const screened = refusedResolverObservations(
      [{ field: 'websiteUrl', value: WRONG }],
      rowRefusing().fieldValueRefusals,
    );

    expect(screened.kept).toEqual([]);
  });
});

describe('a refusal does not keep a good value out', () => {
  /**
   * This is the difference from a lock. A lock removes the field from derivation, so
   * the row can never improve; a refusal removes one value and the next one wins.
   */
  it('does not touch a different value at the same field', () => {
    expect(valueIsRefused(rowRefusing().fieldValueRefusals, 'websiteUrl', RIGHT)).toBe(false);
  });

  it('does not touch the same value at a different field', () => {
    expect(valueIsRefused(rowRefusing().fieldValueRefusals, 'sourceUrls', WRONG)).toBe(false);
  });

  it('stops applying once withdrawn', () => {
    const withdrawn = planFieldValueRefusalWithdrawal(
      rowRefusing().fieldValueRefusals,
      'websiteUrl',
      WRONG,
      'the roster corrected the attribution',
    )[fieldValueRefusalsPath('websiteUrl')];

    expect(valueIsRefused({ websiteUrl: withdrawn }, 'websiteUrl', WRONG)).toBe(false);
    expect(liveFieldValueRefusals({ websiteUrl: withdrawn }, 'websiteUrl')).toEqual([]);
    expect(Array.isArray(withdrawn) && withdrawn[0].withdrawnReason).toBe(
      'the roster corrected the attribution',
    );
  });

  it('refuses nothing on a row that records nothing', () => {
    expect(valueIsRefused(undefined, 'websiteUrl', WRONG)).toBe(false);
    expect(
      refusedResolverObservations([{ field: 'websiteUrl', value: WRONG }], undefined).kept,
    ).toHaveLength(1);
  });
});

describe('recording a refusal', () => {
  it('writes it under the field it names, carrying the rule and who recorded it', () => {
    const update = planFieldValueRefusal(undefined, {
      field: 'websiteUrl',
      value: WRONG,
      rule: 'wrong_owner',
      refusedBy: 'repair:example',
      note: 'the page belongs to another researcher',
      refusedAt: new Date('2026-09-23T00:00:00Z'),
    });

    const recorded = update['fieldValueRefusals.websiteUrl'] as Array<Record<string, unknown>>;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      valueKey: fieldValueRefusalKey('websiteUrl', WRONG),
      rule: 'wrong_owner',
      refusedBy: 'repair:example',
    });
  });

  it('is idempotent, so a re-runnable repair does not grow the record', () => {
    const first = planFieldValueRefusal(undefined, {
      field: 'websiteUrl',
      value: WRONG,
      rule: 'wrong_owner',
      refusedBy: 'repair:example',
    });
    const second = planFieldValueRefusal(
      { websiteUrl: first['fieldValueRefusals.websiteUrl'] },
      {
        field: 'websiteUrl',
        value: WRONG,
        rule: 'wrong_owner',
        refusedBy: 'repair:example',
      },
    );

    expect(second['fieldValueRefusals.websiteUrl']).toHaveLength(1);
  });

  it('keeps an existing refusal at the same field when a second value is refused', () => {
    const first = planFieldValueRefusal(undefined, {
      field: 'websiteUrl',
      value: WRONG,
      rule: 'wrong_owner',
      refusedBy: 'repair:example',
    });
    const second = planFieldValueRefusal(
      { websiteUrl: first['fieldValueRefusals.websiteUrl'] },
      {
        field: 'websiteUrl',
        value: 'https://another.example.org/',
        rule: 'not_this_rows_research',
        refusedBy: 'repair:example',
      },
    );

    expect(second['fieldValueRefusals.websiteUrl']).toHaveLength(2);
  });

  it('refuses to record a refusal with nothing to refuse, or with no author', () => {
    expect(() =>
      planFieldValueRefusal(undefined, {
        field: 'websiteUrl',
        value: '   ',
        rule: 'wrong_owner',
        refusedBy: 'repair:example',
      }),
    ).toThrow(/nothing to refuse/);
    expect(() =>
      planFieldValueRefusal(undefined, {
        field: 'websiteUrl',
        value: WRONG,
        rule: 'wrong_owner',
        refusedBy: '  ',
      }),
    ).toThrow(/must name what recorded it/);
  });

  it('refuses a field name that would write somewhere else', () => {
    expect(() => fieldValueRefusalsPath('a.b')).toThrow(/unusable field name/);
  });

  it('will not withdraw without a reason', () => {
    expect(() =>
      planFieldValueRefusalWithdrawal(rowRefusing().fieldValueRefusals, 'websiteUrl', WRONG, '  '),
    ).toThrow(/requires a reason/);
  });
});

describe('two spellings of one page are one refusal', () => {
  /**
   * The case that needed a second refusal recorded by hand: the engine wanted
   * `.../lab/x/index.aspx` while the record named `.../lab/x/`. A default document is
   * the directory, so one record must cover both (#3191).
   */
  it('folds a default document onto its directory', () => {
    expect(fieldValueRefusalKey('websiteUrl', 'https://example.org/lab/x/index.aspx')).toBe(
      fieldValueRefusalKey('websiteUrl', 'https://example.org/lab/x/'),
    );
    expect(foldDefaultDocumentLeaf('example.org/lab/x/default.html')).toBe('example.org/lab/x');
  });

  it('refuses the variant spelling from a record written against the directory', () => {
    const refusals = {
      websiteUrl: [
        {
          valueKey: fieldValueRefusalKey('websiteUrl', 'https://example.org/lab/x/'),
          rule: 'confirmed_dead_page' as const,
          refusedBy: 'test',
          refusedAt: new Date('2026-09-24T00:00:00Z'),
          note: '',
        },
      ],
    };

    expect(valueIsRefused(refusals, 'websiteUrl', 'https://example.org/lab/x/index.aspx')).toBe(
      true,
    );
  });

  it('does not fold a real page that merely ends in a document name', () => {
    expect(fieldValueRefusalKey('websiteUrl', 'https://example.org/lab/x/people.html')).not.toBe(
      fieldValueRefusalKey('websiteUrl', 'https://example.org/lab/x/'),
    );
  });
});
