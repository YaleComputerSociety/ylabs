import { describe, expect, it } from 'vitest';
import {
  DIRECTORY_REMOVAL_DIGEST,
  DirectoryRemovalKeyError,
  directoryRemovalDigest,
  normalizedDirectoryRemovalValue,
  readDirectoryRemovalKey,
} from '../directoryRemovalDigest';

const KEY = 'synthetic-directory-removal-key-0123456789';
const OTHER_KEY = 'another-synthetic-removal-key-9876543210';

describe('directoryRemovalDigest', () => {
  it('folds the spellings a stored identifier can take into one digest', () => {
    expect(directoryRemovalDigest(KEY, 'netid', ' Abc123 ')).toBe(
      directoryRemovalDigest(KEY, 'netid', 'abc123'),
    );
    expect(directoryRemovalDigest(KEY, 'email', 'Example.Person@Yale.edu')).toBe(
      directoryRemovalDigest(KEY, 'email', 'example.person@yale.edu'),
    );
    expect(directoryRemovalDigest(KEY, 'orcid', 'https://orcid.org/0000-0002-1825-009x/')).toBe(
      directoryRemovalDigest(KEY, 'orcid', '0000-0002-1825-009X'),
    );
    expect(
      directoryRemovalDigest(KEY, 'profile_url', 'https://www.Example.yale.edu/people/someone/'),
    ).toBe(directoryRemovalDigest(KEY, 'profile_url', 'http://example.yale.edu/people/someone'));
    expect(directoryRemovalDigest(KEY, 'name', '  Example   Person ')).toBe(
      directoryRemovalDigest(KEY, 'name', 'example person'),
    );
  });

  it('keeps kinds apart, so a value removed as a name is not removed as a netid', () => {
    expect(directoryRemovalDigest(KEY, 'name', 'abc123')).not.toBe(
      directoryRemovalDigest(KEY, 'netid', 'abc123'),
    );
  });

  it('cannot be reproduced without the key', () => {
    const digest = directoryRemovalDigest(KEY, 'netid', 'abc123');
    expect(digest).toMatch(DIRECTORY_REMOVAL_DIGEST);
    expect(directoryRemovalDigest(OTHER_KEY, 'netid', 'abc123')).not.toBe(digest);
  });

  it('returns nothing for a value that normalizes to nothing', () => {
    expect(directoryRemovalDigest(KEY, 'netid', '   ')).toBeUndefined();
    expect(directoryRemovalDigest(KEY, 'profile_url', 'not a url')).toBeUndefined();
    expect(normalizedDirectoryRemovalValue('email', undefined)).toBe('');
  });
});

describe('readDirectoryRemovalKey', () => {
  it('reads the key inline or from a file and leaves it unset when neither is given', () => {
    expect(readDirectoryRemovalKey({ DIRECTORY_REMOVAL_KEY: ` ${KEY} ` })).toBe(KEY);
    expect(
      readDirectoryRemovalKey({ DIRECTORY_REMOVAL_KEY_FILE: '/synthetic/key' }, (path) => {
        expect(path).toBe('/synthetic/key');
        return `${KEY}\n`;
      }),
    ).toBe(KEY);
    expect(readDirectoryRemovalKey({})).toBeUndefined();
  });

  it('refuses an ambiguous or weak key', () => {
    expect(() =>
      readDirectoryRemovalKey({ DIRECTORY_REMOVAL_KEY: KEY, DIRECTORY_REMOVAL_KEY_FILE: '/x' }),
    ).toThrow(DirectoryRemovalKeyError);
    expect(() => readDirectoryRemovalKey({ DIRECTORY_REMOVAL_KEY: 'short' })).toThrow(
      DirectoryRemovalKeyError,
    );
  });
});
