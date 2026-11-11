import { describe, expect, it } from 'vitest';
import {
  identityWitnessesConflict,
  pageIdentityWitnessesPerson,
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
