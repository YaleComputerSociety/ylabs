import { describe, expect, it } from 'vitest';
import {
  directoryContradictsNetidForAddress,
  directoryNetidsByAddressFrom,
  netidOfNetidUserKey,
  withoutDirectoryContradictedProfileEvidence,
} from '../directoryContradictedProfileNetid';
import { profileIdentityAgreesWithUser } from '../sources/officialProfilePiBackfillScraper';

const LANE = 'official-profile-pi-backfill';
const pageUrl = 'https://engineering.example.test/faculty/rowan-fixture/';

const directory = directoryNetidsByAddressFrom([
  { entityKey: 'rf101', value: 'Rowan.Fixture@yale.edu' },
  { entityKey: 'netid:rf101', value: 'rowan.fixture@yale.edu' },
  { entityKey: 'netid:rowan.fixture', value: 'rowan.fixture@yale.edu' },
]);

const laneObservations = (netid: string) => [
  { sourceName: LANE, field: 'netid', value: netid, sourceUrl: pageUrl },
  { sourceName: LANE, field: 'fname', value: 'Rowan', sourceUrl: pageUrl },
  { sourceName: LANE, field: 'email', value: 'rowan.fixture@yale.edu', sourceUrl: pageUrl },
  { sourceName: LANE, field: 'profileUrls', value: { official: pageUrl }, sourceUrl: pageUrl },
];

describe('directory-contradicted official profile netid screen', () => {
  it('pairs each directory address with the bare netid its key names', () => {
    expect([...(directory.get('rowan.fixture@yale.edu') || [])]).toEqual(['rf101']);
  });

  it('reads a netid only from a netid user key', () => {
    expect(netidOfNetidUserKey('netid:RF101')).toBe('rf101');
    expect(netidOfNetidUserKey('netid:rowan.fixture')).toBe('');
    expect(netidOfNetidUserKey('rf101')).toBe('');
  });

  it('contradicts a netid only when the directory names another one for the address', () => {
    expect(directoryContradictsNetidForAddress('rz202', 'rowan.fixture@yale.edu', directory)).toBe(
      true,
    );
    expect(directoryContradictsNetidForAddress('RF101', 'rowan.fixture@yale.edu', directory)).toBe(
      false,
    );
    expect(
      directoryContradictsNetidForAddress('rz202', 'unlisted.person@yale.edu', directory),
    ).toBe(false);
  });

  it("drops the lane's page evidence from a namesake's netid key", () => {
    const other = {
      sourceName: 'yale-directory',
      field: 'title',
      value: 'Lecturer',
      sourceUrl: '',
    };
    expect(
      withoutDirectoryContradictedProfileEvidence(
        'netid:rz202',
        [...laneObservations('rz202'), other],
        directory,
      ),
    ).toEqual([other]);
  });

  it("keeps the lane's evidence on the key the directory agrees with", () => {
    const observations = laneObservations('rf101');
    expect(
      withoutDirectoryContradictedProfileEvidence('netid:rf101', observations, directory),
    ).toBe(observations);
  });

  it('keeps another page of the lane on the same key', () => {
    const ownPage = {
      sourceName: LANE,
      field: 'title',
      value: 'Professor',
      sourceUrl: 'https://medicine.example.test/profile/rz202/',
    };
    expect(
      withoutDirectoryContradictedProfileEvidence(
        'netid:rz202',
        [...laneObservations('rz202'), ownPage],
        directory,
      ),
    ).toEqual([ownPage]);
  });
});

describe('official profile identity agreement with a candidate researcher', () => {
  const page = { displayName: 'Rowan Fixture', email: 'rowan.fixture@yale.edu' };

  it('accepts the holder of the page address whatever its stored name', () => {
    expect(
      profileIdentityAgreesWithUser(page, {
        displayName: 'R. Fixture',
        email: 'rowan.fixture@yale.edu',
        netid: 'rf101',
      }),
    ).toBe(true);
  });

  it('refuses a namesake with another given name who holds only a netid mailbox', () => {
    expect(
      profileIdentityAgreesWithUser(page, {
        displayName: 'Robin Fixture',
        email: 'rz202@yale.edu',
        netid: 'rz202',
      }),
    ).toBe(false);
  });

  it('refuses a same-named candidate whose own named address differs', () => {
    expect(
      profileIdentityAgreesWithUser(page, {
        displayName: 'Rowan Fixture',
        email: 'rowan.fixture2@yale.edu',
        netid: 'rf303',
      }),
    ).toBe(false);
  });

  it('accepts an agreeing name when the candidate holds only its netid mailbox', () => {
    expect(
      profileIdentityAgreesWithUser(page, {
        displayName: 'Rowan Fixture',
        email: 'rf101@yale.edu',
        netid: 'rf101',
      }),
    ).toBe(true);
  });

  it('accepts an agreeing name when the page prints no address', () => {
    expect(
      profileIdentityAgreesWithUser(
        { displayName: 'Rowan Fixture', email: '' },
        { displayName: 'Rowan Fixture', email: 'rowan.fixture@yale.edu', netid: 'rf101' },
      ),
    ).toBe(true);
  });
});
