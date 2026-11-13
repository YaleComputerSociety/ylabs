import { describe, expect, it } from 'vitest';
import {
  attributeRefusedValueLanes,
  entryIsRefused,
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  observationAssertsRefusedValue,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
  planListEntryRefusalRemoval,
  refusedResolverObservations,
  type FieldValueRefusal,
} from '../researchEntityFieldValueRefusals';

const OWN_PAGE = 'https://example.yale.edu/people/synthetic-person';
const FOREIGN_PAGE = 'https://elsewhere.example.edu/profile/synthetic-namesake';
const GRANT_PAGE = 'https://grants.example.org/award/123';

const refusalOf = (field: string, value: unknown): FieldValueRefusal => ({
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'operator_judgement',
  refusedBy: 'test',
  refusedAt: new Date('2026-11-13T00:00:00Z'),
  note: 'synthetic',
});

const refusing = (field: string, value: unknown) => ({ [field]: [refusalOf(field, value)] });

describe('a single entry of a list field can be refused (#6012)', () => {
  it('drops the refused entry from a list observation and keeps the others', () => {
    const screened = refusedResolverObservations(
      [{ field: 'sourceUrls', value: [OWN_PAGE, FOREIGN_PAGE, GRANT_PAGE] }],
      refusing('sourceUrls', FOREIGN_PAGE),
    );
    expect(screened.kept).toEqual([{ field: 'sourceUrls', value: [OWN_PAGE, GRANT_PAGE] }]);
    expect(screened.refused).toEqual([{ field: 'sourceUrls', rule: 'operator_judgement' }]);
  });

  it('drops a list observation whose every entry is refused', () => {
    const screened = refusedResolverObservations(
      [{ field: 'sourceUrls', value: [FOREIGN_PAGE] }],
      refusing('sourceUrls', FOREIGN_PAGE),
    );
    expect(screened.kept).toEqual([]);
    expect(screened.refused).toHaveLength(1);
  });

  it('matches another spelling of the same refused page', () => {
    const screened = refusedResolverObservations(
      [
        {
          field: 'sourceUrls',
          value: [OWN_PAGE, `${FOREIGN_PAGE}/`.replace('https://', 'http://')],
        },
      ],
      refusing('sourceUrls', FOREIGN_PAGE),
    );
    expect(screened.kept).toEqual([{ field: 'sourceUrls', value: [OWN_PAGE] }]);
  });

  it('still honours a refusal recorded under the earlier plain-text key', () => {
    const legacy = {
      sourceUrls: [
        { ...refusalOf('sourceUrls', FOREIGN_PAGE), valueKey: FOREIGN_PAGE.toLowerCase() },
      ],
    };
    const screened = refusedResolverObservations(
      [{ field: 'sourceUrls', value: [OWN_PAGE, FOREIGN_PAGE] }],
      legacy,
    );
    expect(screened.kept).toEqual([{ field: 'sourceUrls', value: [OWN_PAGE] }]);
    expect(entryIsRefused(legacy, 'sourceUrls', FOREIGN_PAGE)).toBe(true);
  });

  it('still refuses a whole list by its exact value, and only that list', () => {
    const refusals = refusing('sourceUrls', [OWN_PAGE, FOREIGN_PAGE]);
    const screened = refusedResolverObservations(
      [
        { field: 'sourceUrls', value: [OWN_PAGE, FOREIGN_PAGE] },
        { field: 'sourceUrls', value: [OWN_PAGE, GRANT_PAGE] },
      ],
      refusals,
    );
    expect(screened.kept).toEqual([{ field: 'sourceUrls', value: [OWN_PAGE, GRANT_PAGE] }]);
    expect(screened.refused).toHaveLength(1);
  });

  it('leaves a list field that is not entry-refusable untouched', () => {
    const observation = { field: 'researchAreas', value: ['Ecology', 'Hydrology'] };
    const screened = refusedResolverObservations(
      [observation],
      refusing('researchAreas', 'Ecology'),
    );
    expect(screened.kept).toEqual([observation]);
    expect(screened.refused).toEqual([]);
  });

  it('answers entryIsRefused only for an entry-refusable field', () => {
    expect(entryIsRefused(refusing('sourceUrls', FOREIGN_PAGE), 'sourceUrls', FOREIGN_PAGE)).toBe(
      true,
    );
    expect(entryIsRefused(refusing('sourceUrls', FOREIGN_PAGE), 'sourceUrls', OWN_PAGE)).toBe(
      false,
    );
    expect(entryIsRefused(refusing('researchAreas', 'Ecology'), 'researchAreas', 'Ecology')).toBe(
      false,
    );
  });
});

describe('the refusal tool reports what a list-entry refusal would remove (#6012)', () => {
  it('counts the observations and entries carrying the refused entry', () => {
    expect(
      planListEntryRefusalRemoval({
        field: 'sourceUrls',
        value: FOREIGN_PAGE,
        storedValue: [OWN_PAGE, FOREIGN_PAGE],
        observationValues: [
          [OWN_PAGE, FOREIGN_PAGE],
          [FOREIGN_PAGE, `${FOREIGN_PAGE}/`],
          [GRANT_PAGE],
          'not-a-list',
        ],
      }),
    ).toEqual({ observations: 2, entries: 3, storedListCarriesEntry: true });
  });

  it('reports nothing for a field that is not entry-refusable', () => {
    expect(
      planListEntryRefusalRemoval({
        field: 'websiteUrl',
        value: FOREIGN_PAGE,
        storedValue: FOREIGN_PAGE,
        observationValues: [FOREIGN_PAGE],
      }),
    ).toBeUndefined();
  });
});

describe('a list-entry refusal keeps the query that names a citation (#6012)', () => {
  const OWNER_PROFILE = 'https://scholar.example.org/citations?user=AAA';
  const NAMESAKE_PROFILE = 'https://scholar.example.org/citations?user=BBB';

  it('removes only the refused citation when siblings differ by query', () => {
    const screened = refusedResolverObservations(
      [{ field: 'sourceUrls', value: [OWNER_PROFILE, NAMESAKE_PROFILE] }],
      refusing('sourceUrls', NAMESAKE_PROFILE),
    );
    expect(screened.kept).toEqual([{ field: 'sourceUrls', value: [OWNER_PROFILE] }]);
    expect(
      entryIsRefused(refusing('sourceUrls', NAMESAKE_PROFILE), 'sourceUrls', OWNER_PROFILE),
    ).toBe(false);
  });

  it('counts only the refused citation in the dry run', () => {
    expect(
      planListEntryRefusalRemoval({
        field: 'sourceUrls',
        value: NAMESAKE_PROFILE,
        storedValue: [OWNER_PROFILE],
        observationValues: [[OWNER_PROFILE, NAMESAKE_PROFILE], [OWNER_PROFILE]],
      }),
    ).toEqual({ observations: 1, entries: 1, storedListCarriesEntry: false });
  });

  it('credits the citing lane rather than a lane that asserted the URL as a website', () => {
    expect(
      attributeRefusedValueLanes('sourceUrls', fieldValueRefusalKey('sourceUrls', FOREIGN_PAGE), [
        { field: 'websiteUrl', value: FOREIGN_PAGE, sourceName: 'website-lane' },
        { field: 'sourceUrls', value: [FOREIGN_PAGE], sourceName: 'citing-lane' },
      ]),
    ).toEqual(['citing-lane']);
  });
});

describe('a refusal stored under the earlier plain-text key stays manageable (#6012)', () => {
  const legacyRefusals = () => ({
    sourceUrls: [
      { ...refusalOf('sourceUrls', FOREIGN_PAGE), valueKey: FOREIGN_PAGE.toLowerCase() },
    ],
  });

  it('is withdrawn by withdrawing the same URL', () => {
    const update = planFieldValueRefusalWithdrawal(
      legacyRefusals(),
      'sourceUrls',
      FOREIGN_PAGE,
      'reviewed again',
    );
    expect(update['fieldValueRefusals.sourceUrls']).toHaveLength(1);
    expect(
      liveFieldValueRefusals({ sourceUrls: update['fieldValueRefusals.sourceUrls'] }, 'sourceUrls'),
    ).toEqual([]);
  });

  it('is not duplicated by re-refusing the same URL', () => {
    const update = planFieldValueRefusal(legacyRefusals(), {
      field: 'sourceUrls',
      value: FOREIGN_PAGE,
      rule: 'operator_judgement',
      refusedBy: 'test',
      note: 'synthetic',
    });
    expect(update['fieldValueRefusals.sourceUrls']).toHaveLength(1);
  });

  it('is still matched against a cited entry for lane attribution', () => {
    expect(
      observationAssertsRefusedValue('sourceUrls', FOREIGN_PAGE.toLowerCase(), {
        value: [OWN_PAGE, FOREIGN_PAGE],
      }),
    ).toBe(true);
  });
});
