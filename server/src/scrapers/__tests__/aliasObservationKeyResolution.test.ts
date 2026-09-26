import { describe, expect, it } from 'vitest';

import {
  aliasFromObservationKey,
  aliasNameKey,
  indexDirectory,
  planAliasResolutions,
  summarizeAliasResolutions,
  type DirectoryIdentity,
} from '../utils/aliasObservationKeyResolution';

const directory: DirectoryIdentity[] = [
  { netid: 'af42', email: 'ada.fixture1@yale.edu', firstName: 'Ada', lastName: 'Fixture' },
  { netid: 'bq77', email: 'quinn.fixture2@yale.edu', firstName: 'Quinn', lastName: 'Fixture2' },
  { netid: 'cf10', email: 'cam.fixture3@yale.edu', firstName: 'Cam', lastName: "O'Fixture" },
  { netid: 'dt51', email: 'dana.fixture4@yale.edu', firstName: 'Dana', lastName: 'Twinfixture' },
  { netid: 'dt52', email: 'dana.fixture5@yale.edu', firstName: 'Dana', lastName: 'Twinfixture' },
  {
    netid: 'ug99',
    email: 'ula.fixture6@yale.edu',
    firstName: 'Ula',
    lastName: 'Fixture6',
    schoolCode: 'YC',
  },
];

const index = indexDirectory(directory);
const key = (alias: string, observationCount = 1) => ({
  entityKey: `netid:${alias}`,
  observationCount,
});

describe('aliasFromObservationKey', () => {
  it('reads only a dotted netid-shaped key as an alias', () => {
    expect(aliasFromObservationKey('netid:ada.fixture1')).toBe('ada.fixture1');
    expect(aliasFromObservationKey('NETID:Ada.Fixture1')).toBe('ada.fixture1');
    expect(aliasFromObservationKey('netid:af42')).toBe('');
    expect(aliasFromObservationKey('dept-cs-ada-fixture')).toBe('');
    expect(aliasFromObservationKey('netid:ada.fixture1@yale.edu')).toBe('');
  });
});

describe('aliasNameKey', () => {
  it('drops punctuation so a surname with an apostrophe still compares', () => {
    expect(aliasNameKey('cam.ofixture')).toBe('cam|ofixture');
    expect(aliasNameKey('dana.twin-fixture')).toBe('dana|twinfixture');
    expect(aliasNameKey('nodot')).toBe('');
  });
});

describe('planAliasResolutions', () => {
  it('resolves an alias against the directory email and keys the plan by the real netid', () => {
    const outcome = planAliasResolutions([key('ada.fixture1', 40)], index, new Set());
    expect(outcome.refused).toEqual([]);
    expect(outcome.planned).toEqual([
      {
        entityKey: 'netid:ada.fixture1',
        alias: 'ada.fixture1',
        netid: 'af42',
        observationCount: 40,
        matchedBy: 'directory-email',
      },
    ]);
  });

  it('falls back to a name match when the alias is not the email local part', () => {
    const outcome = planAliasResolutions([key('cam.ofixture')], index, new Set());
    expect(outcome.planned[0]).toMatchObject({ netid: 'cf10', matchedBy: 'directory-name' });
  });

  it('leaves an alias the corpus can already resolve alone', () => {
    const outcome = planAliasResolutions([key('ada.fixture1')], index, new Set(['ada.fixture1']));
    expect(outcome.planned).toEqual([]);
    expect(outcome.refused[0].refusal).toBe('already-resolvable-in-corpus');
  });

  it('fails closed when the directory maps one name to two netids', () => {
    const outcome = planAliasResolutions([key('dana.twinfixture')], index, new Set());
    expect(outcome.planned).toEqual([]);
    expect(outcome.refused[0].refusal).toBe('directory-maps-alias-to-many-netids');
  });

  it('prefers a unique email match over a name shared by two people', () => {
    const sharedName = indexDirectory([
      { netid: 'et10', email: 'eve.fixture7@yale.edu', firstName: 'Eve', lastName: 'Twinfixture' },
      { netid: 'et11', email: 'eve.fixture8@yale.edu', firstName: 'Eve', lastName: 'Twinfixture' },
    ]);
    const outcome = planAliasResolutions([key('eve.fixture7')], sharedName, new Set());
    expect(outcome.planned[0]).toMatchObject({ netid: 'et10', matchedBy: 'directory-email' });
  });

  it('refuses an undergraduate rather than minting a student identity', () => {
    const outcome = planAliasResolutions([key('ula.fixture6')], index, new Set());
    expect(outcome.planned).toEqual([]);
    expect(outcome.refused[0].refusal).toBe('directory-person-is-an-undergraduate');
  });

  it('reports absence from the directory as its own verdict', () => {
    const outcome = planAliasResolutions([key('gone.fixture9', 12)], index, new Set());
    expect(outcome.planned).toEqual([]);
    expect(outcome.refused[0]).toMatchObject({
      refusal: 'absent-from-directory',
      observationCount: 12,
    });
  });

  it('refuses a key that is not alias-shaped', () => {
    const outcome = planAliasResolutions(
      [{ entityKey: 'netid:af42', observationCount: 3 }],
      index,
      new Set(),
    );
    expect(outcome.refused[0].refusal).toBe('key-is-not-an-alias');
  });

  it('never resolves an alias to itself', () => {
    const selfIndex = indexDirectory([
      { netid: 'self.alias', email: 'self.alias1@yale.edu', firstName: 'Self', lastName: 'Alias' },
    ]);
    const outcome = planAliasResolutions([key('self.alias')], selfIndex, new Set());
    expect(outcome.planned).toEqual([]);
    expect(outcome.refused[0].refusal).toBe('directory-netid-equals-alias');
  });
});

describe('summarizeAliasResolutions', () => {
  it('counts planned observations and every refusal bucket', () => {
    const outcome = planAliasResolutions(
      [
        key('ada.fixture1', 40),
        key('dana.twinfixture', 5),
        key('gone.fixture9', 12),
        key('ula.fixture6', 7),
      ],
      index,
      new Set(),
    );
    expect(summarizeAliasResolutions(outcome)).toEqual({
      planned: 1,
      plannedObservations: 40,
      byMatch: { 'directory-email': 1 },
      byRefusal: {
        'directory-maps-alias-to-many-netids': 1,
        'absent-from-directory': 1,
        'directory-person-is-an-undergraduate': 1,
      },
      refusedObservations: {
        'directory-maps-alias-to-many-netids': 5,
        'absent-from-directory': 12,
        'directory-person-is-an-undergraduate': 7,
      },
    });
  });
});
