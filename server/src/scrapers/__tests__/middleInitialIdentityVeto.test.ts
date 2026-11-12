import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { givenNamesEquivalent, statedMiddleInitialsConflict } from '../utils/piNameMatch';
import {
  listedPersonIsTheNamedLead,
  namesStateConflictingMiddleInitials,
  observedPersonNameAgreesWith,
} from '../utils/personNameAgreement';
import { statedPersonNamesFrom } from '../utils/personPageStatedNames';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { decideShellMerge } from '../../scripts/dedupeAccountlessResearcherShellsCore';
import {
  identityToUserObservations,
  pageEmailNetidTie,
  type OfficialProfileIdentity,
} from '../sources/officialProfilePiBackfillScraper';

describe('a stated middle initial that differs vetoes a name match (#5979)', () => {
  it('reads two different stated middle initials as two people', () => {
    expect(statedMiddleInitialsConflict('Quinn A.', 'Quinn L.')).toBe(true);
    expect(givenNamesEquivalent('Quinn A.', 'Quinn L.')).toBe(false);
    expect(observedPersonNameAgreesWith('Quinn L. Fixture', 'Quinn A. Fixture')).toBe(false);
    expect(listedPersonIsTheNamedLead('Quinn A. Fixture', 'Quinn L. Fixture')).toBe(false);
  });

  it('still matches the same person written with and without a middle initial', () => {
    expect(givenNamesEquivalent('Quinn', 'Quinn L.')).toBe(true);
    expect(observedPersonNameAgreesWith('Quinn Fixture', 'Quinn L. Fixture')).toBe(true);
    expect(observedPersonNameAgreesWith('Quinn L. Fixture', 'Quinn Fixture')).toBe(true);
    expect(listedPersonIsTheNamedLead('Quinn L. Fixture', 'Quinn Fixture')).toBe(true);
  });

  it('still matches one initial written in a different case or punctuation, or spelled out', () => {
    for (const [left, right] of [
      ['Quinn L.', 'quinn l'],
      ['Quinn L', 'QUINN L.'],
      ['Quinn L.', 'Quinn Lee'],
      ['Quinn-L.', 'Quinn L'],
    ]) {
      expect(statedMiddleInitialsConflict(left, right)).toBe(false);
      expect(givenNamesEquivalent(left, right)).toBe(true);
    }
    expect(observedPersonNameAgreesWith('Quinn L. Fixture', 'quinn l fixture')).toBe(true);
  });

  it('does not read a nickname in parentheses or quotes as a middle name', () => {
    expect(statedMiddleInitialsConflict('Quinn (Bo) L.', 'Quinn L.')).toBe(false);
    expect(statedMiddleInitialsConflict('Quinn "Bo" L.', 'Quinn L.')).toBe(false);
  });

  it('compares middle initials only between names of one first given name and surname', () => {
    expect(namesStateConflictingMiddleInitials('Quinn A. Fixture', 'Quinn L. Fixture')).toBe(true);
    expect(namesStateConflictingMiddleInitials('Quinn A. Fixture', 'Quinn L. Otherfixture')).toBe(
      false,
    );
    expect(namesStateConflictingMiddleInitials('Quinn A. Fixture', 'Quinn Fixture')).toBe(false);
  });

  it('composes a page name from the fname and lname one key read from one page', () => {
    expect(
      statedPersonNamesFrom([
        { entityKey: 'k1', field: 'fname', value: 'Quinn A.', sourceUrl: 'https://a.test/x' },
        { entityKey: 'k1', field: 'lname', value: 'Fixture', sourceUrl: 'https://a.test/x' },
        { entityKey: 'k2', field: 'displayName', value: 'Quinn L. Fixture' },
        { entityKey: 'k3', field: 'fname', value: 'Orphan', sourceUrl: 'https://a.test/y' },
      ]).sort(),
    ).toEqual(['Quinn A. Fixture', 'Quinn L. Fixture']);
  });
});

describe('the person-name resolver applies the middle-initial veto (#5979)', () => {
  const stored = { _id: new mongoose.Types.ObjectId(), displayName: 'Quinn L. Fixture' };
  const deps = {
    findResearchersBySurname: async () => [stored],
    resolveResearcherIdByNetid: async () => undefined,
  };

  it('does not match a name stating another middle initial', async () => {
    const result = await resolveResearcherIdForPersonName('Quinn A. Fixture', { deps });
    expect(result.status).not.toBe('matched');
  });

  it('still matches the same name with no middle initial, or the initial in another case', async () => {
    for (const name of ['Quinn Fixture', 'quinn l fixture', 'Quinn L Fixture']) {
      expect(await resolveResearcherIdForPersonName(name, { deps })).toEqual({
        status: 'matched',
        researcherId: stored._id,
      });
    }
  });
});

describe('the shared-row fold refuses when the two records pages name different people (#5979)', () => {
  const holder = (statedNames: string[]) => ({
    id: 'holder',
    displayName: 'Quinn Fixture',
    tier: 'NETID' as const,
    netid: 'qf5979',
    statedNames,
  });
  const decide = (shell: Record<string, unknown>, statedNames: string[]) =>
    decideShellMerge({ id: 'shell', ...shell }, new Map(), new Map(), [], new Map(), [
      holder(statedNames),
    ]);

  it('refuses an empty-identifier shell whose name states another middle initial than the holder page', () => {
    expect(decide({ displayName: 'Quinn L. Fixture' }, ['Quinn A. Fixture'])).toEqual({
      merge: false,
      reason: 'STATED_MIDDLE_INITIAL_CONFLICT',
      matchedOn: 'shared-row',
    });
  });

  it('refuses when only the shell page states the conflicting initial', () => {
    expect(
      decide({ displayName: 'Quinn Fixture', statedNames: ['Quinn L. Fixture'] }, [
        'Quinn A. Fixture',
      ]),
    ).toEqual({
      merge: false,
      reason: 'STATED_MIDDLE_INITIAL_CONFLICT',
      matchedOn: 'shared-row',
    });
  });

  it('still folds a shell whose name its holder pages state the same way', () => {
    expect(decide({ displayName: 'Quinn L. Fixture' }, ['Quinn L. Fixture'])).toEqual({
      merge: true,
      canonicalId: 'holder',
      reason: 'MERGEABLE',
      matchedOn: 'shared-row',
    });
  });

  it('still folds a shell written without the initial its holder pages state', () => {
    expect(decide({ displayName: 'Quinn Fixture' }, ['Quinn A. Fixture'])).toEqual({
      merge: true,
      canonicalId: 'holder',
      reason: 'MERGEABLE',
      matchedOn: 'shared-row',
    });
  });

  it('still folds when the holder pages state nothing', () => {
    expect(decide({ displayName: 'Quinn L. Fixture' }, [])).toEqual({
      merge: true,
      canonicalId: 'holder',
      reason: 'MERGEABLE',
      matchedOn: 'shared-row',
    });
  });
});

describe('a page email is filed under a netid only when something ties the two (#5979)', () => {
  const NETID = 'qf5979';
  const pageIdentity = (
    email: string,
    extra: Partial<OfficialProfileIdentity> = {},
  ): OfficialProfileIdentity =>
    ({
      displayName: 'Quinn Fixture',
      email,
      canonicalUrl: 'https://fixture.yale.edu/profile/quinn-fixture/',
      fetchedUrl: 'https://fixture.yale.edu/profile/quinn-fixture/',
      title: '',
      departments: [],
      researchInterests: [],
      ...extra,
    }) as OfficialProfileIdentity;
  const researcher = { netid: NETID, displayName: 'Quinn Fixture' };
  const directoryPairing = (email: string, netid: string) => new Map([[email, new Set([netid])]]);
  const emailsFiled = (
    identity: OfficialProfileIdentity,
    options: Parameters<typeof identityToUserObservations>[2] = {},
  ) =>
    identityToUserObservations(identity, researcher, options)
      .filter((o) => o.field === 'email')
      .map((o) => o.value);

  it('admits the netid mailbox', () => {
    const identity = pageIdentity(`${NETID}@yale.edu`);
    expect(pageEmailNetidTie(identity, researcher, undefined)).toEqual({ tie: 'netid-mailbox' });
    expect(emailsFiled(identity)).toEqual([`${NETID}@yale.edu`]);
  });

  it('admits an address the directory pairs with the netid', () => {
    const identity = pageIdentity('example.unrelated@yale.edu');
    const directory = directoryPairing('example.unrelated@yale.edu', NETID);
    expect(pageEmailNetidTie(identity, researcher, directory)).toEqual({
      tie: 'directory-pairs-netid',
    });
    expect(emailsFiled(identity, { directoryNetidsByAddress: directory })).toEqual([
      'example.unrelated@yale.edu',
    ]);
  });

  it('admits an address on a page that states the netid', () => {
    const identity = pageIdentity('example.unrelated@yale.edu', { profileNetid: NETID });
    expect(pageEmailNetidTie(identity, researcher, undefined)).toEqual({
      tie: 'page-states-netid',
    });
    expect(emailsFiled(identity)).toEqual(['example.unrelated@yale.edu']);
  });

  it('admits an address on a page whose ORCID another page filed under the netid', () => {
    const identity = pageIdentity('example.unrelated@yale.edu');
    expect(pageEmailNetidTie(identity, researcher, undefined, true)).toEqual({
      tie: 'page-orcid-witnessed-for-netid',
    });
    expect(emailsFiled(identity, { pageOrcidWitnessedForNetid: true })).toEqual([
      'example.unrelated@yale.edu',
    ]);
  });

  it('admits an address whose local part agrees with the netid initials', () => {
    const identity = pageIdentity('quinn.fixture@yale.edu');
    expect(pageEmailNetidTie(identity, researcher, undefined)).toEqual({
      tie: 'local-part-agrees-with-netid',
    });
    expect(emailsFiled(identity)).toEqual(['quinn.fixture@yale.edu']);
  });

  it('refuses an address the directory pairs with another netid, even when the local part agrees', () => {
    const identity = pageIdentity('quinn.fixture@yale.edu');
    const directory = directoryPairing('quinn.fixture@yale.edu', 'zz9999');
    expect(pageEmailNetidTie(identity, researcher, directory)).toEqual({
      refusal: 'directory-pairs-another-netid',
    });
    expect(emailsFiled(identity, { directoryNetidsByAddress: directory })).toEqual([]);
  });

  it('refuses an agreeing local part when the page person states another middle initial than the researcher', () => {
    const identity = pageIdentity('quinn.fixture@yale.edu', { displayName: 'Quinn A. Fixture' });
    const namedResearcher = { netid: NETID, displayName: 'Quinn L. Fixture' };
    expect(pageEmailNetidTie(identity, namedResearcher, undefined)).toEqual({
      refusal: 'middle-initial-conflict',
    });
    expect(
      identityToUserObservations(identity, namedResearcher).some((o) => o.field === 'email'),
    ).toBe(false);
  });

  it('refuses a local part stating another middle initial than the researcher', () => {
    const identity = pageIdentity('quinn.a.fixture@yale.edu');
    const namedResearcher = { netid: NETID, displayName: 'Quinn L. Fixture' };
    expect(pageEmailNetidTie(identity, namedResearcher, undefined)).toEqual({
      refusal: 'middle-initial-conflict',
    });
  });

  it('refuses an address nothing ties to the netid, but still files the page name', () => {
    const identity = pageIdentity('example.unrelated@yale.edu');
    expect(pageEmailNetidTie(identity, researcher, undefined)).toEqual({ refusal: 'untied' });
    const filed = identityToUserObservations(identity, researcher).map((o) => o.field);
    expect(filed).not.toContain('email');
    expect(filed).toEqual(expect.arrayContaining(['fname', 'lname']));
  });

  it('re-derives the same filing on a second run', () => {
    const identity = pageIdentity('example.unrelated@yale.edu');
    expect(identityToUserObservations(identity, researcher)).toEqual(
      identityToUserObservations(identity, researcher),
    );
  });
});
