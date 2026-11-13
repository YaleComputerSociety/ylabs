import { describe, expect, it } from 'vitest';

import {
  OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
  isOverSharedPersonImage,
  overSharedPersonImageKeys,
  overSharedStoredPersonImageKeys,
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

describe('a picture stored on many researchers with different identities is a default (#6043)', () => {
  const holder = (id: string, netid?: string, displayName = `Fixture ${id}`) => ({
    _id: id,
    displayName,
    identifiers: netid ? { netid } : {},
    profile: { imageUrl: DEFAULT_PICTURE },
  });

  it('marks a picture three researchers with different netids store', () => {
    const keys = overSharedStoredPersonImageKeys([
      holder('r1', 'fx1'),
      holder('r2', 'fx2'),
      holder('r3'),
    ]);
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(true);
  });

  it('counts twin records sharing one netid once', () => {
    const keys = overSharedStoredPersonImageKeys([
      holder('r1', 'fx1'),
      holder('r2', 'FX1'),
      holder('r3', 'fx3'),
    ]);
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(false);
  });

  it('keeps a picture two researchers store', () => {
    const keys = overSharedStoredPersonImageKeys([holder('r1', 'fx1'), holder('r2', 'fx2')]);
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(false);
  });

  it('counts the researchers live evidence names once their stored copies are cleared', () => {
    const cleared = (id: string, netid: string | undefined, displayName: string) => ({
      ...holder(id, netid, displayName),
      profile: {},
    });
    const keys = overSharedStoredPersonImageKeys(
      [
        cleared('r1', 'fx1', 'Fixture One'),
        cleared('r2', undefined, 'Fixture Two'),
        cleared('r3', 'fx3', 'Fixture Three'),
      ],
      [
        {
          value: DEFAULT_PICTURE,
          entityKey: 'netid:fx1',
          sourceName: 'official-profile-pi-backfill',
        },
        {
          value: DEFAULT_PICTURE,
          entityKey: 'dept:fixture:fixture-two',
          sourceName: 'dept-faculty-roster',
        },
        {
          value: DEFAULT_PICTURE,
          entityKey: 'dept:other:fixture-two',
          sourceName: 'dept-faculty-roster',
        },
        { value: DEFAULT_PICTURE, entityKey: 'netid:fx3', sourceName: 'yale-directory' },
      ],
    );
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(true);
  });

  it('counts a researcher and its own evidence as one identity', () => {
    const keys = overSharedStoredPersonImageKeys(
      [holder('r1', 'fx1', 'Fixture One'), holder('r2', undefined, 'Fixture Two')],
      [
        {
          value: DEFAULT_PICTURE,
          entityKey: 'netid:fx1',
          sourceName: 'official-profile-pi-backfill',
        },
        {
          value: DEFAULT_PICTURE,
          entityKey: 'dept:fixture:fixture-two',
          sourceName: 'dept-faculty-roster',
        },
      ],
    );
    expect(isOverSharedPersonImage(DEFAULT_PICTURE, keys)).toBe(false);
  });
});
