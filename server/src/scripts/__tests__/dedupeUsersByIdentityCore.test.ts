import { describe, expect, it } from 'vitest';
import {
  buildUserIdentityDedupeSummary,
  buildUserIdentityDedupePlan,
  chooseCanonicalUser,
  parseDedupeUsersByIdentityArgs,
} from '../dedupeUsersByIdentityCore';
import { buildPostMaterializationIntegritySummary } from '../../scrapers/integrityGate';

describe('parseDedupeUsersByIdentityArgs', () => {
  it('defaults to dry-run with a bounded limit', () => {
    expect(parseDedupeUsersByIdentityArgs([])).toEqual({
      apply: false,
      confirmUserIdentityDedupe: false,
      limit: 100,
      limitProvided: false,
      sampleSize: 25,
    });
  });

  it('parses apply, limit, and identity-field flags', () => {
    expect(
      parseDedupeUsersByIdentityArgs([
        '--',
        '--apply',
        '--confirm-user-identity-dedupe',
        '--limit=25',
        '--identity-field=email',
      ]),
    ).toEqual({
      apply: true,
      confirmUserIdentityDedupe: true,
      limit: 25,
      limitProvided: true,
      identityField: 'email',
      sampleSize: 25,
    });
  });

  it('parses output, sample-size, and max-apply-groups flags', () => {
    expect(
      parseDedupeUsersByIdentityArgs([
        '--apply',
        '--confirm-user-identity-dedupe',
        '--output=tmp/user-dedupe/summary.json',
        '--sample-size=3',
        '--max-apply-groups=2',
      ]),
    ).toEqual({
      apply: true,
      confirmUserIdentityDedupe: true,
      limit: 100,
      limitProvided: false,
      output: 'tmp/user-dedupe/summary.json',
      sampleSize: 3,
      maxApplyGroups: 2,
    });
  });

  it('rejects non-positive sample-size and max-apply-groups values', () => {
    expect(() => parseDedupeUsersByIdentityArgs(['--sample-size=0'])).toThrow(
      '--sample-size must be a positive integer',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--max-apply-groups=0'])).toThrow(
      '--max-apply-groups must be a positive integer',
    );
  });

  it('rejects non-literal positive integer bounds before running user dedupe', () => {
    expect(() => parseDedupeUsersByIdentityArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--sample-size=1e3'])).toThrow(
      '--sample-size must be a positive integer',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--max-apply-groups=1e3'])).toThrow(
      '--max-apply-groups must be a positive integer',
    );
  });

  it('rejects malformed paired CLI values before running user dedupe', () => {
    expect(() => parseDedupeUsersByIdentityArgs(['--output', '--apply'])).toThrow(
      '--output requires a value',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--identity-field', '--limit=5'])).toThrow(
      '--identity-field requires a value',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--limit=bad'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['--confirm-user-identity-dedupe=true'])).toThrow(
      '--confirm-user-identity-dedupe does not accept a value',
    );
    expect(() => parseDedupeUsersByIdentityArgs(['prod'])).toThrow('Unknown argument: prod');
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
        identityValue: 'fixture.canonical@example.test',
        users: [
          {
            id: 'fixture-canonical',
            netid: 'fc1001',
            email: 'fixture.canonical@example.test',
            fname: 'Fixture',
            lname: 'Canonical',
            userConfirmed: true,
          },
          {
            id: 'fixture-collision',
            netid: 'fc2002',
            email: 'fixture.canonical@example.test',
            fname: 'Collision',
            lname: 'Person',
            userConfirmed: true,
          },
          {
            id: 'fixture-generated',
            netid: 'fixture.canonical',
            email: 'fixture.canonical@example.test',
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
      identityValue: 'fixture.canonical@example.test',
      canonicalUserId: 'fixture-canonical',
      duplicateUserIds: ['fixture-generated'],
      normalizedName: 'fixture canonical',
    });
    expect(plan.warningGroups).toHaveLength(1);
    expect(plan.warningGroups[0]).toMatchObject({
      identityField: 'email',
      identityValue: 'fixture.canonical@example.test',
      reason: 'identity-shared-by-different-names',
      normalizedNames: ['collision person', 'fixture canonical'],
      userIds: ['fixture-canonical', 'fixture-collision', 'fixture-generated'],
    });
  });

  it('normalizes accents when identifying same-person duplicates', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'accent.case-name@example.test',
        users: [
          {
            id: 'a',
            netid: 'af1001',
            email: 'accent.case-name@example.test',
            fname: 'Accent',
            lname: 'Case-Name',
            userConfirmed: true,
          },
          {
            id: 'b',
            netid: 'accent.fixture',
            email: 'accent.case-name@example.test',
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
        identityField: 'orcid',
        identityValue: 'https://orcid.org/0000-0000-0000-0001',
        users: [
          {
            id: 'short-middle',
            orcid: 'https://orcid.org/0000-0000-0000-0001',
            fname: 'Alfa',
            lname: 'Example',
          },
          {
            id: 'long-middle',
            orcid: 'https://orcid.org/0000-0000-0000-0001',
            fname: 'Alfa Beta',
            lname: 'Example',
          },
        ],
      },
      {
        identityField: 'orcid',
        identityValue: 'https://orcid.org/0000-0000-0000-0002',
        users: [
          {
            id: 'short-expanded',
            orcid: 'https://orcid.org/0000-0000-0000-0002',
            fname: 'Jord',
            lname: 'Sample',
          },
          {
            id: 'long-expanded',
            orcid: 'https://orcid.org/0000-0000-0000-0002',
            fname: 'Jordan',
            lname: 'Sample',
          },
        ],
      },
      {
        identityField: 'orcid',
        identityValue: 'https://orcid.org/0000-0000-0000-0003',
        users: [
          {
            id: 'plain-year',
            orcid: 'https://orcid.org/0000-0000-0000-0003',
            fname: 'Year',
            lname: 'Fixture',
          },
          {
            id: 'with-year',
            orcid: 'https://orcid.org/0000-0000-0000-0003',
            fname: 'Year',
            lname: 'Fixture 1932 2025',
          },
        ],
      },
    ]);

    expect(plan.warningGroups).toEqual([]);
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

  it('keeps conflicted external identity collisions out of automatic merge plans', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/a-conflicted',
        users: [
          {
            id: 'first-a',
            openAlexId: 'https://openalex.org/a-conflicted',
            fname: 'First',
            lname: 'Person',
          },
          {
            id: 'first-b',
            openAlexId: 'https://openalex.org/a-conflicted',
            fname: 'F.',
            lname: 'Person',
          },
          {
            id: 'second-a',
            openAlexId: 'https://openalex.org/a-conflicted',
            fname: 'Second',
            lname: 'Person',
          },
          {
            id: 'second-b',
            openAlexId: 'https://openalex.org/a-conflicted',
            fname: 'S.',
            lname: 'Person',
          },
        ],
      },
    ]);

    expect(plan.groups).toEqual([]);
    expect(plan.warningGroups).toEqual([
      {
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/a-conflicted',
        reason: 'identity-shared-by-different-names',
        normalizedNames: ['f person', 's person'],
        userIds: ['first-a', 'first-b', 'second-a', 'second-b'],
      },
    ]);
  });

  it('keeps generic department email collisions out of automatic merge plans', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'economics@yale.edu',
        users: [
          {
            id: 'econ-a',
            email: 'economics@yale.edu',
            fname: 'Francesco',
            lname: 'Agostinelli',
          },
          {
            id: 'econ-b',
            email: 'economics@yale.edu',
            fname: 'Francesco',
            lname: 'Agostinelli',
          },
        ],
      },
    ]);

    expect(plan.groups).toEqual([]);
    expect(plan.warningGroups).toEqual([
      {
        identityField: 'email',
        identityValue: 'economics@yale.edu',
        reason: 'email-not-person-specific',
        normalizedNames: ['francesco agostinelli'],
        userIds: ['econ-a', 'econ-b'],
      },
    ]);
  });

  it('still plans person-specific reversed and initial email variants', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'coifman-ronald@yale.edu',
        users: [
          {
            id: 'coifman-a',
            email: 'coifman-ronald@yale.edu',
            fname: 'Ronald',
            lname: 'Coifman',
            userConfirmed: true,
          },
          {
            id: 'coifman-b',
            email: 'coifman-ronald@yale.edu',
            fname: 'Ronald',
            lname: 'Coifman',
          },
        ],
      },
      {
        identityField: 'email',
        identityValue: 'd.silverman@yale.edu',
        users: [
          {
            id: 'silverman-a',
            email: 'd.silverman@yale.edu',
            fname: 'David',
            lname: 'Silverman',
            userConfirmed: true,
          },
          {
            id: 'silverman-b',
            email: 'd.silverman@yale.edu',
            fname: 'David',
            lname: 'Silverman',
          },
        ],
      },
    ]);

    expect(plan.groups).toEqual([
      expect.objectContaining({
        identityValue: 'coifman-ronald@yale.edu',
        canonicalUserId: 'coifman-a',
        duplicateUserIds: ['coifman-b'],
      }),
      expect.objectContaining({
        identityValue: 'd.silverman@yale.edu',
        canonicalUserId: 'silverman-a',
        duplicateUserIds: ['silverman-b'],
      }),
    ]);
    expect(plan.warningGroups).toEqual([]);
  });
});

describe('buildUserIdentityDedupeSummary', () => {
  it('sorts planned groups and warnings deterministically before sampling', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/a2',
        users: [
          { id: 'z-canonical', fname: 'Zeta', lname: 'Person', userConfirmed: true },
          { id: 'z-duplicate', fname: 'Z.', lname: 'Person' },
        ],
      },
      {
        identityField: 'email',
        identityValue: 'alpha.person@example.test',
        users: [
          { id: 'alpha-duplicate', fname: 'Alpha', lname: 'Person' },
          { id: 'alpha-canonical', fname: 'Alpha', lname: 'Person', userConfirmed: true },
        ],
      },
      {
        identityField: 'email',
        identityValue: 'warning@example.test',
        users: [
          { id: 'warning-z', fname: 'Zed', lname: 'Person' },
          { id: 'warning-a', fname: 'Alpha', lname: 'Different' },
        ],
      },
    ]);

    const summary = buildUserIdentityDedupeSummary({
      apply: false,
      plan,
      sampleSize: 1,
      applied: [],
    });

    expect(summary.plannedGroups).toBe(2);
    expect(summary.warningGroups).toBe(1);
    expect(summary.plan).toEqual([
      expect.objectContaining({
        identityField: 'email',
        identityValue: 'alpha.person@example.test',
        canonicalUserId: 'alpha-canonical',
      }),
    ]);
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        identityField: 'email',
        identityValue: 'warning@example.test',
        userIds: ['warning-a', 'warning-z'],
      }),
    ]);
  });

  it('limits unique planned groups included in apply summaries', () => {
    const plan = buildUserIdentityDedupePlan([
      {
        identityField: 'email',
        identityValue: 'first.person@example.test',
        users: [
          { id: 'first-canonical', fname: 'First', lname: 'Person', userConfirmed: true },
          { id: 'first-duplicate', fname: 'F.', lname: 'Person' },
        ],
      },
      {
        identityField: 'email',
        identityValue: 'second.person@example.test',
        users: [
          { id: 'second-canonical', fname: 'Second', lname: 'Person', userConfirmed: true },
          { id: 'second-duplicate', fname: 'S.', lname: 'Person' },
        ],
      },
    ]);

    const summary = buildUserIdentityDedupeSummary({
      apply: true,
      plan,
      sampleSize: 25,
      maxApplyGroups: 1,
      applied: [],
    });

    expect(summary.plannedGroups).toBe(1);
    expect(summary.duplicateUsers).toBe(1);
    expect(summary.plan).toHaveLength(1);
  });
});

describe('post-materialization identity warning classification', () => {
  it('does not recommend apply-mode user identity dedupe from integrity failures', () => {
    const summary = buildPostMaterializationIntegritySummary({
      duplicatePersonGroups: [
        {
          identityField: 'email',
          identityValue: 'same.person@example.test',
          userIds: ['canonical-user', 'duplicate-user'],
        },
      ],
    });

    expect(summary.status).toBe('failure');
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server users:dedupe-by-identity --limit=1000',
    );
    expect(summary.recommendedCommands).not.toContain(
      'SCRAPER_ENV=beta yarn --cwd server users:dedupe-by-identity --limit=1000 --apply',
    );
  });

  it('classifies duplicate identity conflicts as a promotion blocker with a dry-run command', () => {
    const summary = buildPostMaterializationIntegritySummary({
      warnings: [
        {
          name: 'duplicatePersonIdentityConflicts',
          count: 1329,
          message:
            'Some user identity values are shared by different names; review or repair source identity fields before merging.',
        },
      ],
    });

    expect(summary.status).toBe('pass');
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        name: 'duplicatePersonIdentityConflicts',
        classification: 'must_fix_before_promotion',
        owner: 'identity/account operator',
        nextCommand:
          'SCRAPER_ENV=beta yarn --cwd server users:repair-mismatched-emails --limit=10000 --output /tmp/ylabs-mismatched-person-email-repair.json',
      }),
    ]);
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server users:repair-mismatched-emails --limit=10000 --output /tmp/ylabs-mismatched-person-email-repair.json',
    );
  });
});
