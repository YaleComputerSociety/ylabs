import { describe, expect, it } from 'vitest';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import {
  DirectoryRemovalUnavailableError,
  assertDirectoryRemovalMatchable,
  buildDirectoryRemovalMatcher,
} from '../directoryRemovalMatcher';

const KEY = 'synthetic-directory-removal-key-0123456789';
const LOCAL_ENV = { NODE_ENV: 'development', SERVER_BASE_URL: 'http://localhost:4000' };
const DEPLOYED_ENV = { NODE_ENV: 'production', SERVER_BASE_URL: 'https://example.invalid' };

const removedPerson = {
  displayName: 'Synthetic Removed Person',
  identifiers: { netid: 'zz9001', email: 'removed.person@example.edu' },
  profileLinks: [{ url: 'https://medicine.yale.edu/profile/synthetic-removed-person/' }],
};
const otherPerson = {
  displayName: 'Synthetic Other Person',
  identifiers: { netid: 'zz9002' },
  profileLinks: [{ url: 'https://medicine.yale.edu/profile/synthetic-other-person/' }],
};

const digest = (kind: Parameters<typeof directoryRemovalDigest>[1], value: string) =>
  directoryRemovalDigest(KEY, kind, value)!;

describe('buildDirectoryRemovalMatcher', () => {
  it('is inert while no entry exists, with or without a key', () => {
    for (const key of [undefined, KEY]) {
      const matcher = buildDirectoryRemovalMatcher({ key, activeDigests: [], env: DEPLOYED_ENV });
      expect(matcher.state).toBe('inert');
      expect(matcher.isRemovedPerson(removedPerson)).toBe(false);
      expect(matcher.isRemovedName('Synthetic Removed Person')).toBe(false);
    }
  });

  it('removes a person by any one of their identifiers and nobody else', () => {
    for (const entry of [
      digest('netid', 'ZZ9001'),
      digest('email', 'Removed.Person@example.edu'),
      digest('profile_url', 'https://medicine.yale.edu/profile/synthetic-removed-person'),
    ]) {
      const matcher = buildDirectoryRemovalMatcher({ key: KEY, activeDigests: [entry] });
      expect(matcher.state).toBe('active');
      expect(matcher.isRemovedPerson(removedPerson)).toBe(true);
      expect(matcher.isRemovedPerson(otherPerson)).toBe(false);
      expect(matcher.isRemovedPerson(null)).toBe(false);
    }
  });

  it('applies a name entry to names only, so a namesake researcher keeps their identity', () => {
    const matcher = buildDirectoryRemovalMatcher({
      key: KEY,
      activeDigests: [digest('name', 'Synthetic Removed Person')],
    });
    expect(matcher.isRemovedName('synthetic  removed person')).toBe(true);
    expect(matcher.isRemovedName('Synthetic Other Person')).toBe(false);
    expect(matcher.isRemovedPerson(removedPerson)).toBe(false);
  });

  it('withholds every name in a deployed runtime that holds entries but no key', () => {
    const matcher = buildDirectoryRemovalMatcher({
      key: undefined,
      activeDigests: [digest('netid', 'zz9001')],
      env: DEPLOYED_ENV,
    });
    expect(matcher.state).toBe('withholding_every_name');
    expect(matcher.isRemovedPerson(otherPerson)).toBe(true);
    expect(matcher.isRemovedName('Synthetic Other Person')).toBe(true);
    expect(() => assertDirectoryRemovalMatchable(matcher)).toThrow(
      DirectoryRemovalUnavailableError,
    );
  });

  it('leaves names unfiltered on a loopback development server that holds entries but no key', () => {
    const matcher = buildDirectoryRemovalMatcher({
      key: undefined,
      activeDigests: [digest('netid', 'zz9001')],
      env: LOCAL_ENV,
    });
    expect(matcher.state).toBe('unfiltered_local');
    expect(matcher.isRemovedPerson(removedPerson)).toBe(false);
    expect(() => assertDirectoryRemovalMatchable(matcher)).toThrow(
      DirectoryRemovalUnavailableError,
    );
  });
});
