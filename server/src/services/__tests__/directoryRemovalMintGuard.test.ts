import { describe, expect, it } from 'vitest';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import {
  buildDirectoryRemovalMatcher,
  DirectoryRemovalUnavailableError,
} from '../directoryRemovalMatcher';
import {
  createDirectoryRemovalMintGuard,
  currentDirectoryRemovalMintGuard,
  withDirectoryRemovalMintGuard,
} from '../directoryRemovalMintGuard';

const KEY = 'synthetic-directory-removal-key-0123456789';

const digest = (kind: Parameters<typeof directoryRemovalDigest>[1], value: string) =>
  directoryRemovalDigest(KEY, kind, value)!;

const guardFor = (activeDigests: string[], key: string | undefined = KEY) =>
  createDirectoryRemovalMintGuard(
    buildDirectoryRemovalMatcher({
      key,
      activeDigests,
      env: { NODE_ENV: 'development', SERVER_BASE_URL: 'http://localhost:4000' },
    }),
  );

const removed = {
  displayName: 'Synthetic Removed Person',
  identifiers: { netid: 'zz9001' },
  profileLinks: [{ url: 'https://example.edu/profile/synthetic-removed-person' }],
};

describe('createDirectoryRemovalMintGuard', () => {
  it('refuses nobody and counts nothing while the list is empty', () => {
    const guard = guardFor([]);
    expect(guard.active).toBe(false);
    expect(guard.refusesPerson(removed)).toBe(false);
    expect(guard.refusesIdentifiedPerson(removed)).toBe(false);
    expect(guard.refusals).toBe(0);
  });

  it('refuses a person by any identifier or profile link they hold', () => {
    for (const entry of [
      digest('netid', 'zz9001'),
      digest('profile_url', 'https://example.edu/profile/synthetic-removed-person/'),
    ]) {
      const guard = guardFor([entry]);
      expect(guard.refusesPerson(removed)).toBe(true);
      expect(guard.refusesIdentifiedPerson(removed)).toBe(true);
      expect(
        guard.refusesPerson({ ...removed, identifiers: { netid: 'zz9002' }, profileLinks: [] }),
      ).toBe(false);
    }
  });

  it('never refuses a researcher on a name entry, keyed or keyless', () => {
    const guard = guardFor([digest('name', 'Synthetic Removed Person')]);
    expect(guard.refusesPerson({ displayName: 'Synthetic Removed Person' })).toBe(false);
    expect(guard.refusesPerson(removed)).toBe(false);
    expect(guard.refusesIdentifiedPerson({ displayName: 'Synthetic Removed Person' })).toBe(false);
  });

  it('counts each recorded refusal', () => {
    const guard = guardFor([digest('netid', 'zz9001')]);
    guard.recordRefusal();
    guard.recordRefusal();
    expect(guard.refusals).toBe(2);
  });

  it('refuses to run when entries exist and no key can tell who they name', () => {
    expect(() => guardFor([digest('netid', 'zz9001')], '')).toThrow(
      DirectoryRemovalUnavailableError,
    );
  });
});

describe('withDirectoryRemovalMintGuard', () => {
  it('hands every check in a pass the one guard it was given', async () => {
    const guard = guardFor([digest('netid', 'zz9001')]);
    const seen = await withDirectoryRemovalMintGuard(async () => {
      const nested = await withDirectoryRemovalMintGuard(() => currentDirectoryRemovalMintGuard());
      return [await currentDirectoryRemovalMintGuard(), nested];
    }, guard);
    expect(seen).toEqual([guard, guard]);
  });
});
