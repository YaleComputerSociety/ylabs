import { describe, expect, it } from 'vitest';
import { assertRepairMismatchedPersonEmailsApplyAllowed } from '../repairMismatchedPersonEmails';
import {
  buildMismatchedPersonEmailRepairPlan,
  parseRepairMismatchedPersonEmailsArgs,
} from '../repairMismatchedPersonEmailsCore';

describe('repair mismatched person emails core', () => {
  it('plans safe netid fallback repairs for Yale emails that name another person', () => {
    const summary = buildMismatchedPersonEmailRepairPlan({
      users: [
        {
          id: 'u1',
          netid: 'jmg257',
          fname: 'Jordan',
          lname: 'Mismatch',
          email: 'sage.mismatch@yale.edu',
        },
        {
          id: 'u2',
          netid: 'dimaio',
          fname: 'Daniel',
          lname: 'DiMaio',
          email: 'drew.match@yale.edu',
        },
        {
          id: 'u3',
          netid: 'yy259',
          fname: 'Yang',
          lname: 'Yang-Hartwich',
          email: 'yarden.match@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['u1', 'sage.mismatch@yale.edu'],
        ['u0', 'sage.mismatch@yale.edu'],
        ['u2', 'drew.match@yale.edu'],
        ['u3', 'yarden.match@yale.edu'],
      ]),
    });

    expect(summary).toMatchObject({
      candidateUsers: 1,
      repairableUsers: 1,
      skippedUsers: 0,
    });
    expect(summary.repairs).toEqual([
      {
        userId: 'u1',
        name: 'Jordan Mismatch',
        netid: 'jmg257',
        currentEmail: 'sage.mismatch@yale.edu',
        repairEmail: 'jmg257@yale.edu',
        reason: 'email-does-not-match-person-name',
      },
    ]);
    expect(summary.externalIdentityRepairs).toEqual([]);
  });

  it('skips repairs that would collide with an active user email', () => {
    const summary = buildMismatchedPersonEmailRepairPlan({
      users: [
        {
          id: 'u1',
          netid: 'jm284',
          fname: 'Jacob',
          lname: 'Musser',
          email: 'sage.mismatch@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['u1', 'sage.mismatch@yale.edu'],
        ['u0', 'sage.mismatch@yale.edu'],
        ['u2', 'jm284@yale.edu'],
      ]),
    });

    expect(summary.repairs).toEqual([]);
    expect(summary.externalIdentityRepairs).toEqual([]);
    expect(summary.skipped).toEqual([
      {
        userId: 'u1',
        name: 'Jacob Musser',
        netid: 'jm284',
        currentEmail: 'sage.mismatch@yale.edu',
        reason: 'repair-email-already-used',
      },
    ]);
  });

  it('plans conservative ORCID cleanup when a different-name shell shares an official profile owner ORCID', () => {
    const summary = buildMismatchedPersonEmailRepairPlan({
      users: [
        {
          id: 'todd',
          netid: 'rtc3',
          fname: 'Taylor',
          lname: 'Constable',
          email: 'taylor.constable@yale.edu',
          orcid: '0000-0001-5661-9521',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/taylor-constable/',
          },
        },
        {
          id: 'robert',
          netid: 'rc2442',
          fname: 'Riley',
          lname: 'OtherFixture',
          email: 'rc2442@yale.edu',
          orcid: '0000-0001-5661-9521',
          profileUrls: {
            orcid: 'https://orcid.org/0000-0001-5661-9521',
          },
        },
        {
          id: 'jason',
          netid: 'jmc325',
          fname: 'Jesse',
          lname: 'Crawford',
          email: 'jesse.crawford@yale.edu',
          orcid: '0000-0002-7583-1242',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/jesse-crawford/',
          },
        },
        {
          id: 'juliett',
          netid: 'jc245',
          fname: 'Jordan',
          lname: 'OtherFixture',
          email: 'jordan.crawford@yale.edu',
          orcid: '0000-0002-7583-1242',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/jesse-crawford/',
            orcid: 'https://orcid.org/0000-0002-7583-1242',
          },
        },
      ],
      activeEmailsByUserId: new Map([
        ['todd', 'taylor.constable@yale.edu'],
        ['robert', 'rc2442@yale.edu'],
        ['jason', 'jesse.crawford@yale.edu'],
        ['juliett', 'jordan.crawford@yale.edu'],
      ]),
    });

    expect(summary.repairs).toEqual([]);
    expect(summary.externalIdentityRepairs).toEqual([
      {
        userId: 'robert',
        name: 'Riley OtherFixture',
        identityField: 'orcid',
        identityValue: '0000-0001-5661-9521',
        clearOrcid: true,
        removeProfileUrlKeys: ['orcid'],
        canonicalUserIds: ['todd'],
        reason: 'orcid-shared-by-different-name-with-official-profile-owner',
      },
      {
        userId: 'juliett',
        name: 'Jordan OtherFixture',
        identityField: 'orcid',
        identityValue: '0000-0002-7583-1242',
        clearOrcid: true,
        removeProfileUrlKeys: ['medicine', 'orcid'],
        canonicalUserIds: ['jason'],
        reason: 'orcid-shared-by-different-name-with-official-profile-owner',
      },
    ]);
    expect(summary).toMatchObject({
      candidateUsers: 2,
      repairableUsers: 2,
      skippedUsers: 0,
    });
  });

  it('parses guarded apply arguments', () => {
    expect(
      parseRepairMismatchedPersonEmailsArgs([
        '--limit=1000',
        '--max-apply',
        '5',
        '--apply',
        '--confirm-mismatched-email-repair',
        '--output=/tmp/out.json',
      ]),
    ).toEqual({
      apply: true,
      confirmMismatchedEmailRepair: true,
      limit: 1000,
      limitProvided: true,
      maxApply: 5,
      output: '/tmp/out.json',
    });
  });

  it('rejects non-literal integer bounds before repair planning', () => {
    expect(() => parseRepairMismatchedPersonEmailsArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseRepairMismatchedPersonEmailsArgs(['--max-apply=1e3'])).toThrow(
      '--max-apply must be a positive integer',
    );
    expect(() =>
      parseRepairMismatchedPersonEmailsArgs(['--output=/var/tmp/mismatched-emails.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseRepairMismatchedPersonEmailsArgs(['--output=/tmp/mismatched-emails.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });
});

describe('repair mismatched person emails apply guard', () => {
  it('requires confirmation, limit, and max apply in apply mode', () => {
    expect(() =>
      assertRepairMismatchedPersonEmailsApplyAllowed({
        apply: true,
        confirmMismatchedEmailRepair: false,
        limit: 100,
        limitProvided: true,
        maxApply: 1,
      }),
    ).toThrow('--confirm-mismatched-email-repair is required');

    expect(() =>
      assertRepairMismatchedPersonEmailsApplyAllowed({
        apply: true,
        confirmMismatchedEmailRepair: true,
        limit: 100,
        limitProvided: false,
        maxApply: 1,
      }),
    ).toThrow('--limit is required');

    expect(() =>
      assertRepairMismatchedPersonEmailsApplyAllowed({
        apply: true,
        confirmMismatchedEmailRepair: true,
        limit: 100,
        limitProvided: true,
      }),
    ).toThrow('--max-apply is required');
  });
});
