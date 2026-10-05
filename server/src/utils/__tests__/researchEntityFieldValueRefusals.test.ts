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

  it('matches one prose value wrapped differently, so a newline cannot evade a refusal', () => {
    const body = 'The Fixture Lab studies how metabolic pathways are regulated in disease.';
    const refusals = {
      fullDescription: [
        {
          valueKey: fieldValueRefusalKey('fullDescription', body),
          rule: 'not_this_rows_research' as const,
          refusedBy: 'test',
          refusedAt: new Date(),
          note: '',
        },
      ],
    };

    expect(
      valueIsRefused(
        refusals,
        'fullDescription',
        '  The Fixture Lab studies how metabolic\n   pathways are regulated in disease.  ',
      ),
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

describe('an operator judgement must carry its reason (#3368)', () => {
  const declaration = {
    field: 'websiteUrl',
    value: 'https://example.edu/not-this-rows-site/',
    refusedBy: 'research-entity:refuse-field-value (operator)',
  };

  it('refuses to record an operator judgement with no note', () => {
    expect(() =>
      planFieldValueRefusal(undefined, { ...declaration, rule: 'operator_judgement' }),
    ).toThrow(/must carry a note/i);
    expect(() =>
      planFieldValueRefusal(undefined, { ...declaration, rule: 'operator_judgement', note: '   ' }),
    ).toThrow(/must carry a note/i);
  });

  it('records it when the note is there', () => {
    const update = planFieldValueRefusal(undefined, {
      ...declaration,
      rule: 'operator_judgement',
      note: 'The page belongs to a different record, checked against its own lead.',
    });

    expect((update['fieldValueRefusals.websiteUrl'] as any[])[0].note).toContain(
      'belongs to a different record',
    );
  });

  // Every other rule names a condition a later reader can re-derive, so a blank note
  // there is thin rather than unreadable.
  it('leaves a re-derivable rule alone', () => {
    expect(() =>
      planFieldValueRefusal(undefined, { ...declaration, rule: 'confirmed_dead_page' }),
    ).not.toThrow();
  });
});

describe('planFieldValueRefusal sourceName', () => {
  const declaration = {
    field: 'websiteUrl',
    value: 'https://example.edu/lab',
    rule: 'wrong_owner' as const,
    refusedBy: 'test',
  };

  it('records the lane that produced the refused value', () => {
    const update = planFieldValueRefusal(undefined, {
      ...declaration,
      sourceName: 'labMicrositeScraper',
    });
    const [refusal] = update['fieldValueRefusals.websiteUrl'] as Array<Record<string, unknown>>;

    expect(refusal.sourceName).toBe('labMicrositeScraper');
    expect(refusal.refusedBy).toBe('test');
  });

  it('omits the field entirely when no lane is named, rather than storing a blank', () => {
    const update = planFieldValueRefusal(undefined, declaration);
    const [refusal] = update['fieldValueRefusals.websiteUrl'] as Array<Record<string, unknown>>;

    expect('sourceName' in refusal).toBe(false);
  });

  it('treats a whitespace-only lane name as absent', () => {
    const update = planFieldValueRefusal(undefined, { ...declaration, sourceName: '   ' });
    const [refusal] = update['fieldValueRefusals.websiteUrl'] as Array<Record<string, unknown>>;

    expect('sourceName' in refusal).toBe(false);
  });
});
