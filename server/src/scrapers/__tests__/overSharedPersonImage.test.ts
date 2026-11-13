import { describe, expect, it } from 'vitest';

import {
  OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
  isOverSharedPersonImage,
  overSharedPersonImageKeys,
  withoutOverSharedPersonImageObservations,
} from '../overSharedPersonImage';

const DEFAULT_PICTURE =
  'https://dept.yale.edu/sites/default/files/styles/social_media/public/campus-fixture.jpg';
const OWN_PICTURE = 'https://dept.yale.edu/sites/default/files/styles/headshot/public/person-0.jpg';

const assertions = (value: string, count: number, sourceName = 'official-profile-pi-backfill') =>
  Array.from({ length: count }, (_, index) => ({
    value,
    entityKey: `netid:fx${index}`,
    sourceName,
  }));

describe('a picture one source asserts for many different people is nobody’s portrait (#6043)', () => {
  it('marks a picture asserted for the threshold of distinct people, across renditions', () => {
    const keys = overSharedPersonImageKeys([
      ...assertions(DEFAULT_PICTURE, OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS - 1),
      {
        value: DEFAULT_PICTURE.replace('styles/social_media/public/', '') + '?itok=fixture',
        entityKey: 'netid:fx-other',
        sourceName: 'official-profile-pi-backfill',
      },
    ]);
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(true);
  });

  it('keeps a picture below the threshold', () => {
    const keys = overSharedPersonImageKeys(
      assertions(DEFAULT_PICTURE, OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS - 1),
    );
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(false);
  });

  it('counts one person read under a different key by each lane as one person', () => {
    const keys = overSharedPersonImageKeys([
      { value: OWN_PICTURE, entityKey: 'netid:fx0', sourceName: 'official-profile-pi-backfill' },
      { value: OWN_PICTURE, entityKey: 'dept:fixture:person-0', sourceName: 'dept-faculty-roster' },
      { value: OWN_PICTURE, entityKey: 'email:fx0@example.edu', sourceName: 'yale-directory' },
    ]);
    expect(isOverSharedPersonImage(OWN_PICTURE, keys)).toBe(false);
  });

  it('counts one person read off several department rosters as one person', () => {
    const keys = overSharedPersonImageKeys(
      ['fixture-a', 'fixture-b', 'fixture-c'].map((roster) => ({
        value: OWN_PICTURE,
        entityKey: `dept:${roster}:person-0`,
        sourceName: 'dept-faculty-roster',
      })),
    );
    expect(isOverSharedPersonImage(OWN_PICTURE, keys)).toBe(false);
  });

  it('still marks a roster picture shared by different people on one roster', () => {
    const keys = overSharedPersonImageKeys(
      Array.from({ length: OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS }, (_, index) => ({
        value: DEFAULT_PICTURE,
        entityKey: `dept:fixture-a:person-${index}`,
        sourceName: 'dept-faculty-roster',
      })),
    );
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(true);
  });

  it('drops only the over-shared image observations', () => {
    const keys = overSharedPersonImageKeys(
      assertions(DEFAULT_PICTURE, OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS),
    );
    const kept = withoutOverSharedPersonImageObservations(
      [
        { field: 'imageUrl', value: DEFAULT_PICTURE },
        { field: 'imageUrl', value: OWN_PICTURE },
        { field: 'website', value: DEFAULT_PICTURE },
      ],
      keys,
    );
    expect(kept.map((observation) => observation.value)).toEqual([OWN_PICTURE, DEFAULT_PICTURE]);
  });
});
