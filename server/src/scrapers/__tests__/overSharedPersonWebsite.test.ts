import { describe, expect, it } from 'vitest';

import {
  OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS,
  isOverSharedPersonWebsite,
  overSharedPersonWebsiteKeys,
  personWebsiteShareKey,
  withoutOverSharedPersonWebsiteObservations,
} from '../overSharedPersonWebsite';

const CHROME_PAGE = 'https://school.example.edu/about/giving/fixture-fund-story/';
const LAB_SITE = 'https://school.example.edu/lab/fixture-lab/';

const assertions = (value: string, count: number, form: 'entityId' | 'entityKey' = 'entityKey') =>
  Array.from({ length: count }, (_, index) =>
    form === 'entityKey'
      ? { value, entityKey: `dept:fixture:person-${index}` }
      : { value, entityId: `id-${index}` },
  );

describe('a website asserted for many different people is nobody’s own (#5645)', () => {
  it('folds case, www, and a trailing slash into one share key', () => {
    expect(personWebsiteShareKey('https://WWW.School.example.edu/About/Giving/')).toBe(
      'school.example.edu/about/giving',
    );
    expect(personWebsiteShareKey('https://school.example.edu/about/giving')).toBe(
      'school.example.edu/about/giving',
    );
    expect(personWebsiteShareKey('https://sites.example.edu/page?person=one')).not.toBe(
      personWebsiteShareKey('https://sites.example.edu/page?person=two'),
    );
    expect(personWebsiteShareKey('mailto:fixture@example.edu')).toBeUndefined();
    expect(personWebsiteShareKey('not a url')).toBeUndefined();
  });

  it('marks a value asserted for the threshold of distinct people, counting slash variants together', () => {
    const half = OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS / 2;
    const keys = overSharedPersonWebsiteKeys([
      ...assertions(CHROME_PAGE, half, 'entityKey'),
      ...assertions(CHROME_PAGE.replace(/\/$/, ''), half, 'entityId'),
    ]);

    expect(isOverSharedPersonWebsite(CHROME_PAGE, keys)).toBe(true);
  });

  it('keeps a lab site its members list, below the threshold', () => {
    const keys = overSharedPersonWebsiteKeys([
      ...assertions(LAB_SITE, 20),
      ...assertions(CHROME_PAGE, OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS),
    ]);

    expect(isOverSharedPersonWebsite(LAB_SITE, keys)).toBe(false);
    expect(isOverSharedPersonWebsite(CHROME_PAGE, keys)).toBe(true);
  });

  it('counts people, not repeated assertions by one person', () => {
    const repeated = Array.from({ length: OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS * 2 }, () => ({
      value: CHROME_PAGE,
      entityKey: 'dept:fixture:one-person',
    }));

    expect(overSharedPersonWebsiteKeys(repeated).size).toBe(0);
  });

  it('drops only website observations holding an over-shared value', () => {
    const keys = new Set([personWebsiteShareKey(CHROME_PAGE) as string]);
    const kept = withoutOverSharedPersonWebsiteObservations(
      [
        { field: 'website', value: CHROME_PAGE },
        { field: 'websiteUrl', value: CHROME_PAGE },
        { field: 'website', value: LAB_SITE },
        { field: 'sourceUrl', value: CHROME_PAGE },
      ],
      keys,
    );

    expect(kept).toEqual([
      { field: 'website', value: LAB_SITE },
      { field: 'sourceUrl', value: CHROME_PAGE },
    ]);
  });
});
