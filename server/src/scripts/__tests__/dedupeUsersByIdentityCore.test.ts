import { describe, expect, it } from 'vitest';
import {
  buildUserIdentityDedupePlan,
  chooseCanonicalUser,
  parseDedupeUsersByIdentityArgs,
} from '../dedupeUsersByIdentityCore';

describe('parseDedupeUsersByIdentityArgs', () => {
  it('defaults to dry-run with a bounded limit', () => {
    expect(parseDedupeUsersByIdentityArgs([])).toEqual({
      apply: false,
      limit: 100,
    });
  });

  it('parses apply, limit, and identity-field flags', () => {
    expect(
      parseDedupeUsersByIdentityArgs(['--', '--apply', '--limit=25', '--identity-field=email']),
    ).toEqual({
      apply: true,
      limit: 25,
      identityField: 'email',
    });
  });
});

describe('chooseCanonicalUser', () => {
  it('prefers confirmed real-netid users over generated scraper identities', () => {
    expect(
      chooseCanonicalUser([
        {
          id: 'generated',
          netid: 'fixture.person',
          email: 'fixture.person@example.test',
          fname: 'Fixture',
          lname: 'Person',
          userConfirmed: false,
          departments: ['Economics'],
        },
        {
          id: 'real',
          netid: 'fp1001',
          email: 'fixture.person@example.test',
          fname: 'Fixture',
          lname: 'Person',
          userConfirmed: true,
          openAlexId: 'https://openalex.org/A0000000001',
        },
      ]),
    ).toMatchObject({ id: 'real' });
  });
});

describe('buildUserIdentityDedupePlan', () => {
  it('plans same-person duplicate groups and preserves mismatched identity collisions as warnings', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'shared.identity@example.test',
        users: [
          {
            id: 'fixture-canonical',
            netid: 'fc1001',
            email: 'shared.identity@example.test',
            fname: 'Fixture',
            lname: 'Canonical',
            userConfirmed: true,
          },
          {
            id: 'fixture-collision',
            netid: 'fc2002',
            email: 'shared.identity@example.test',
            fname: 'Collision',
            lname: 'Person',
            userConfirmed: true,
          },
          {
            id: 'fixture-generated',
            netid: 'fixture.canonical',
            email: 'shared.identity@example.test',
            fname: 'Fixture',
            lname: 'Canonical',
            userConfirmed: false,
          },
        ],
      },
    ]);

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      identityField: 'email',
      identityValue: 'shared.identity@example.test',
      canonicalUserId: 'fixture-canonical',
      duplicateUserIds: ['fixture-generated'],
      normalizedName: 'fixture canonical',
    });
    expect(plan.warningGroups).toHaveLength(1);
    expect(plan.warningGroups[0]).toMatchObject({
      identityField: 'email',
      identityValue: 'shared.identity@example.test',
      reason: 'identity-shared-by-different-names',
      normalizedNames: ['collision person', 'fixture canonical'],
      userIds: ['fixture-canonical', 'fixture-collision', 'fixture-generated'],
    });
  });

  it('normalizes accents when identifying same-person duplicates', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'accented.fixture@example.test',
        users: [
          {
            id: 'a',
            netid: 'af1001',
            email: 'accented.fixture@example.test',
            fname: 'Accent',
            lname: 'Case-Name',
            userConfirmed: true,
          },
          {
            id: 'b',
            netid: 'accent.fixture',
            email: 'accented.fixture@example.test',
            fname: 'Accent',
            lname: 'Cásé-Name',
            userConfirmed: false,
          },
        ],
      },
    ]);

    expect(plan.groups[0]).toMatchObject({
      canonicalUserId: 'a',
      duplicateUserIds: ['b'],
      normalizedName: 'accent case name',
    });
  });

  it('clusters middle-name, initial, year suffix, and expanded given-name variants', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'variant.fixture@example.test',
        users: [
          {
            id: 'short-middle',
            email: 'variant.fixture@example.test',
            fname: 'Alfa',
            lname: 'Example',
          },
          {
            id: 'long-middle',
            email: 'variant.fixture@example.test',
            fname: 'Alfa Beta',
            lname: 'Example',
          },
          {
            id: 'short-expanded',
            email: 'variant.fixture@example.test',
            fname: 'Jord',
            lname: 'Sample',
          },
          {
            id: 'long-expanded',
            email: 'variant.fixture@example.test',
            fname: 'Jordan',
            lname: 'Sample',
          },
          {
            id: 'plain-year',
            email: 'variant.fixture@example.test',
            fname: 'Year',
            lname: 'Fixture',
          },
          {
            id: 'with-year',
            email: 'variant.fixture@example.test',
            fname: 'Year',
            lname: 'Fixture 1932 2025',
          },
        ],
      },
    ]);

    expect(plan.warningGroups).toEqual([
      expect.objectContaining({
        normalizedNames: ['alfa example', 'jord sample', 'year fixture'],
      }),
    ]);
    expect(plan.groups).toEqual([
      expect.objectContaining({ normalizedName: 'alfa example' }),
      expect.objectContaining({ normalizedName: 'jord sample' }),
      expect.objectContaining({ duplicateUserIds: ['with-year'], normalizedName: 'year fixture' }),
    ]);
    expect(plan.groups.find((group) => group.normalizedName === 'alfa example')).toMatchObject({
      canonicalUserId: expect.any(String),
      duplicateUserIds: [expect.any(String)],
    });
    expect(plan.groups.find((group) => group.normalizedName === 'jord sample')).toMatchObject({
      canonicalUserId: expect.any(String),
      duplicateUserIds: [expect.any(String)],
    });
  });
});
