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
          fname: 'Joshua',
          lname: 'Gendron',
          email: 'susan.k.brady@yale.edu',
        },
        {
          id: 'u2',
          netid: 'dimaio',
          fname: 'Daniel',
          lname: 'DiMaio',
          email: 'daniel.dimaio@yale.edu',
        },
        {
          id: 'u3',
          netid: 'yy259',
          fname: 'Yang',
          lname: 'Yang-Hartwich',
          email: 'yang.yang@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['u1', 'susan.k.brady@yale.edu'],
        ['u0', 'susan.k.brady@yale.edu'],
        ['u2', 'daniel.dimaio@yale.edu'],
        ['u3', 'yang.yang@yale.edu'],
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
        name: 'Joshua Gendron',
        netid: 'jmg257',
        currentEmail: 'susan.k.brady@yale.edu',
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
          email: 'susan.k.brady@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['u1', 'susan.k.brady@yale.edu'],
        ['u0', 'susan.k.brady@yale.edu'],
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
        currentEmail: 'susan.k.brady@yale.edu',
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
          fname: 'Todd',
          lname: 'Constable',
          email: 'todd.constable@yale.edu',
          orcid: '0000-0001-5661-9521',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/todd-constable/',
          },
        },
        {
          id: 'robert',
          netid: 'rc2442',
          fname: 'Robert',
          lname: 'Constable',
          email: 'rc2442@yale.edu',
          orcid: '0000-0001-5661-9521',
          profileUrls: {
            orcid: 'https://orcid.org/0000-0001-5661-9521',
          },
        },
        {
          id: 'jason',
          netid: 'jmc325',
          fname: 'Jason',
          lname: 'Crawford',
          email: 'jason.crawford@yale.edu',
          orcid: '0000-0002-7583-1242',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/jason-crawford/',
          },
        },
        {
          id: 'juliett',
          netid: 'jc245',
          fname: 'Juliett',
          lname: 'Crawford',
          email: 'juliett.crawford@yale.edu',
          orcid: '0000-0002-7583-1242',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/jason-crawford/',
            orcid: 'https://orcid.org/0000-0002-7583-1242',
          },
        },
      ],
      activeEmailsByUserId: new Map([
        ['todd', 'todd.constable@yale.edu'],
        ['robert', 'rc2442@yale.edu'],
        ['jason', 'jason.crawford@yale.edu'],
        ['juliett', 'juliett.crawford@yale.edu'],
      ]),
    });

    expect(summary.repairs).toEqual([]);
    expect(summary.externalIdentityRepairs).toEqual([
      {
        userId: 'robert',
        name: 'Robert Constable',
        identityField: 'orcid',
        identityValue: '0000-0001-5661-9521',
        clearOrcid: true,
        removeProfileUrlKeys: ['orcid'],
        canonicalUserIds: ['todd'],
        reason: 'orcid-shared-by-different-name-with-official-profile-owner',
      },
      {
        userId: 'juliett',
        name: 'Juliett Crawford',
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
