import { describe, expect, it } from 'vitest';
import {
  directoryPairsAddressesWithAnotherNetid,
  identityWitnessesConflict,
  pageIdentityWitnessesPerson,
  pageWitnessSettlesConflictForCandidate,
} from '../officialProfileLinkIdentity';

describe('identityWitnessesConflict (#5605)', () => {
  it('reads two different netids as two people', () => {
    expect(
      identityWitnessesConflict(
        { _id: 'a', identifiers: { netid: 'zza5605' } },
        { _id: 'b', identifiers: { netid: 'zzb5605' } },
      ),
    ).toBe(true);
  });

  it('decides nothing when either record has no netid, so a twin is never refused', () => {
    expect(
      identityWitnessesConflict({ _id: 'a', identifiers: {} }, { _id: 'b', netid: 'zzb5605' }),
    ).toBe(false);
    expect(
      identityWitnessesConflict({ _id: 'a', identifiers: { netid: 'zza5605' } }, { _id: 'b' }),
    ).toBe(false);
  });

  it('does not read differing emails as a conflict, because one person can have several', () => {
    expect(
      identityWitnessesConflict(
        { _id: 'a', identifiers: { email: 'one.synthetic5605@yale.edu' } },
        { _id: 'b', identifiers: { email: 'two.synthetic5605@yale.edu' } },
      ),
    ).toBe(false);
  });

  it('reads an email alias stored as a netid as no witness, so it never conflicts a real netid (#5740)', () => {
    expect(
      identityWitnessesConflict(
        { _id: 'a', identifiers: { netid: 'robin.fixture' } },
        { _id: 'b', identifiers: { netid: 'abc123' } },
      ),
    ).toBe(false);
    expect(
      identityWitnessesConflict(
        { _id: 'a', identifiers: { netid: 'abc123' } },
        { _id: 'b', netid: 'robin.fixture' },
      ),
    ).toBe(false);
  });

  it('never conflicts a record with itself', () => {
    expect(
      identityWitnessesConflict(
        { _id: 'same', identifiers: { netid: 'zza5605' } },
        { _id: 'same', identifiers: { netid: 'zzb5605' } },
      ),
    ).toBe(false);
  });
});

describe('pageIdentityWitnessesPerson (#5605)', () => {
  const person = { identifiers: { netid: 'zzc5605', email: 'casey.synthetic@yale.edu' } };

  it('accepts the page when its email is the person address', () => {
    expect(pageIdentityWitnessesPerson({ email: 'Casey.Synthetic@yale.edu' }, person)).toBe(true);
  });

  it('accepts the page when it states the person netid, as a slug or as an email', () => {
    expect(pageIdentityWitnessesPerson({ netid: 'zzc5605' }, person)).toBe(true);
    expect(
      pageIdentityWitnessesPerson(
        { email: 'zzc5605@yale.edu' },
        { identifiers: { netid: 'zzc5605' } },
      ),
    ).toBe(true);
  });

  it('reads a netid only from a Yale address, never from an outside one (#5669)', () => {
    expect(
      pageIdentityWitnessesPerson(
        { email: 'zzc5605@example.org' },
        { identifiers: { netid: 'zzc5605' } },
      ),
    ).toBe(false);
  });

  it('accepts the page when the directory pairs its email with the person netid', () => {
    const directory = new Map([['casey.s@yale.edu', new Set(['zzc5605'])]]);
    expect(
      pageIdentityWitnessesPerson(
        { email: 'casey.s@yale.edu' },
        { identifiers: { netid: 'zzc5605' } },
        directory,
      ),
    ).toBe(true);
  });

  it('refuses a page that states someone else, or nothing at all', () => {
    expect(pageIdentityWitnessesPerson({ email: 'other.synthetic5605@yale.edu' }, person)).toBe(
      false,
    );
    expect(pageIdentityWitnessesPerson({}, person)).toBe(false);
    expect(pageIdentityWitnessesPerson(undefined, person)).toBe(false);
  });

  it('refuses when the researcher carries no witness to compare against', () => {
    expect(pageIdentityWitnessesPerson({ email: 'casey.synthetic@yale.edu' }, {})).toBe(false);
  });
});

describe('pageWitnessSettlesConflictForCandidate (#5733)', () => {
  const page = 'https://medicine.yale.edu/profile/casey-synthetic/';
  const owners = (netids: string[]) => ({
    byPage: new Map([['medicine.yale.edu/profile/casey-synthetic', new Set(netids)]]),
    directoryNetids: new Set(netids),
  });
  const candidate = { _id: 'a', identifiers: { netid: 'zzc5733' } };
  const holder = { _id: 'b', identifiers: { netid: 'zzd5733' } };

  it('lets the candidate through when the page names only the candidate', () => {
    expect(
      pageWitnessSettlesConflictForCandidate(owners(['zzc5733']), page, candidate, [holder]),
    ).toBe(true);
  });

  it('settles nothing when the page names both, the holder alone, or nobody', () => {
    for (const named of [['zzc5733', 'zzd5733'], ['zzd5733'], []]) {
      expect(pageWitnessSettlesConflictForCandidate(owners(named), page, candidate, [holder])).toBe(
        false,
      );
    }
    expect(pageWitnessSettlesConflictForCandidate(undefined, page, candidate, [holder])).toBe(
      false,
    );
  });
});

describe('directoryPairsAddressesWithAnotherNetid (#5765)', () => {
  const directory = new Map<string, Set<string>>([
    ['robin.fixture@yale.edu', new Set(['rf456'])],
    ['abc123@yale.edu', new Set(['abc123'])],
    ['shared.fixture@yale.edu', new Set(['abc123', 'rf456'])],
    ['dotted.fixture@yale.edu', new Set(['dotted.alias'])],
  ]);
  const candidate = { identifiers: { netid: 'abc123' } };

  it('reads an address the directory gives only to another netid as a different person', () => {
    expect(
      directoryPairsAddressesWithAnotherNetid(['Robin.Fixture@yale.edu'], candidate, directory),
    ).toBe(true);
  });

  it('decides nothing when any address the directory pairs names the candidate', () => {
    expect(
      directoryPairsAddressesWithAnotherNetid(
        ['robin.fixture@yale.edu', 'abc123@yale.edu'],
        candidate,
        directory,
      ),
    ).toBe(false);
    expect(
      directoryPairsAddressesWithAnotherNetid(['shared.fixture@yale.edu'], candidate, directory),
    ).toBe(false);
  });

  it('decides nothing for an address the directory does not pair', () => {
    expect(
      directoryPairsAddressesWithAnotherNetid(
        ['unknown@fixture.example.edu'],
        candidate,
        directory,
      ),
    ).toBe(false);
  });

  it('decides nothing for a candidate with no netid, a non-netid value, or one the directory does not hold', () => {
    const other = ['robin.fixture@yale.edu'];
    expect(directoryPairsAddressesWithAnotherNetid(other, { identifiers: {} }, directory)).toBe(
      false,
    );
    expect(
      directoryPairsAddressesWithAnotherNetid(
        other,
        { identifiers: { netid: 'robin.alias.fixture' } },
        directory,
      ),
    ).toBe(false);
    expect(
      directoryPairsAddressesWithAnotherNetid(
        other,
        { identifiers: { netid: 'zz999' } },
        directory,
      ),
    ).toBe(false);
  });

  it('ignores a paired value that is not netid-shaped', () => {
    expect(
      directoryPairsAddressesWithAnotherNetid(['dotted.fixture@yale.edu'], candidate, directory),
    ).toBe(false);
  });
});
