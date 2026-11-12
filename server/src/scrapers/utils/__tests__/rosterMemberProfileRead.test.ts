import { describe, expect, it, vi } from 'vitest';
import {
  readRosterMemberIdentityEvidence,
  memberIdentityEvidenceFor,
} from '../rosterMemberProfileRead';

const page = (email: string) =>
  `<html><body><h1>Profile</h1><a href="mailto:${email}">Email</a></body></html>`;

describe('readRosterMemberIdentityEvidence (#5927)', () => {
  it('reads each Yale-hosted member page once and keys its evidence by profile and name', async () => {
    const yaleProfile = 'https://medicine.yale.edu/profile/quinn-synthetic/';
    const fetchPage = vi.fn(async () => page('quinn.synthetic4@yale.edu'));
    const member = { name: 'Quinn Synthetic', profileUrl: yaleProfile };

    const evidence = await readRosterMemberIdentityEvidence(
      [member, member, { name: 'Rowan Synthetic', profileUrl: 'https://rowan.example.org/' }],
      { sourceName: 'fixture-source', useCache: false, fetchPage },
    );

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(memberIdentityEvidenceFor(evidence, member)?.emails).toEqual([
      'quinn.synthetic4@yale.edu',
    ]);
    expect(
      memberIdentityEvidenceFor(evidence, {
        name: 'Rowan Synthetic',
        profileUrl: 'https://rowan.example.org/',
      }),
    ).toBeUndefined();
  });

  it('skips a member page that fails to load instead of failing the roster', async () => {
    const member = {
      name: 'Quinn Synthetic',
      profileUrl: 'https://medicine.yale.edu/profile/quinn-synthetic/',
    };
    const evidence = await readRosterMemberIdentityEvidence([member], {
      sourceName: 'fixture-source',
      useCache: false,
      fetchPage: async () => {
        throw new Error('Request failed with status code 404');
      },
    });

    expect(memberIdentityEvidenceFor(evidence, member)).toBeUndefined();
  });
});
