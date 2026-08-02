import { describe, expect, it } from 'vitest';
import {
  facultyImportMongoUpdate,
  findCollidingFacultyImportOrcids,
  safeFacultyImportEmail,
  safeFacultyImportExternalIdentity,
} from '../facultyImportIdentity';

describe('faculty import identity guards', () => {
  it('replaces a wrong-person name-shaped email with the verified NetID address', () => {
    expect(
      safeFacultyImportEmail({
        netid: 'test947',
        name: 'Jordan Mismatch',
        email: 'sage.mismatch@yale.edu',
      }),
    ).toBe('test947@yale.edu');
  });

  it('keeps a person-specific Yale email and normalizes mailto casing', () => {
    expect(
      safeFacultyImportEmail({
        netid: 'test739',
        name: 'Drew Match',
        email: 'MAILTO:Drew.Match@yale.edu',
      }),
    ).toBe('drew.match@yale.edu');
  });

  it('drops an ORCID and its profile URL when different faculty rows claim it', () => {
    const entries = [
      { netid: 'one1', name: 'First Person', orcid: '0000-0002-7934-7159' },
      { netid: 'two2', name: 'Second Person', orcid: '0000-0002-7934-7159' },
    ];
    const collisions = findCollidingFacultyImportOrcids(entries);
    expect(collisions).toEqual(new Set(['0000-0002-7934-7159']));
    expect(
      safeFacultyImportExternalIdentity(
        {
          ...entries[0],
          profileUrls: {
            orcid: 'https://orcid.org/0000-0002-7934-7159',
            yale: 'https://example.yale.edu/profile/first-person',
          },
        },
        collisions,
      ),
    ).toEqual({
      profileUrls: { yale: 'https://example.yale.edu/profile/first-person' },
      clearOrcid: true,
    });
  });

  it.each([
    'https://ORCID.org/0000-0002-7934-7159',
    'https://www.orcid.org/0000-0002-7934-7159/',
    '0000000279347159',
    '0000 0002 7934 7159',
    'ORCID: 0000-0002-7934-7159',
  ])('detects mixed scalar and profile URL claims in %s form', (profileOrcid) => {
    const collisions = findCollidingFacultyImportOrcids([
      { netid: 'one1', orcid: '0000-0002-7934-7159' },
      { netid: 'two2', profileUrls: { orcid: profileOrcid } },
    ]);

    expect(collisions).toEqual(new Set(['0000-0002-7934-7159']));
  });

  it('normalizes case variants before persistence', () => {
    expect(
      safeFacultyImportExternalIdentity(
        {
          netid: 'one1',
          orcid: 'orcid: 0000-0000-0000-001x',
          profileUrls: { orcid: 'https://ORCID.org/0000-0000-0000-001x/' },
        },
        new Set(),
      ),
    ).toEqual({
      orcid: '0000-0000-0000-001X',
      profileUrls: { orcid: 'https://orcid.org/0000-0000-0000-001X' },
      clearOrcid: false,
    });
  });

  it('marks a colliding update to clear a stored scalar ORCID', () => {
    const identity = safeFacultyImportExternalIdentity(
      {
        netid: 'one1',
        orcid: '0000-0002-7934-7159',
        profileUrls: {
          orcid: 'https://orcid.org/0000-0002-7934-7159',
          yale: 'https://example.yale.edu/profile/first-person',
        },
      },
      new Set(['0000-0002-7934-7159']),
    );
    expect(identity).toEqual({
      profileUrls: { yale: 'https://example.yale.edu/profile/first-person' },
      clearOrcid: true,
    });
    expect(
      facultyImportMongoUpdate({ profileUrls: identity.profileUrls }, identity.clearOrcid),
    ).toEqual({
      $set: { profileUrls: { yale: 'https://example.yale.edu/profile/first-person' } },
      $unset: { orcid: 1 },
    });
  });

  it('preserves a unique ORCID and unrelated profile URLs', () => {
    expect(
      safeFacultyImportExternalIdentity(
        {
          netid: 'one1',
          name: 'First Person',
          orcid: '0000-0000-0000-001X',
          profileUrls: { orcid: 'https://orcid.org/0000-0000-0000-001X' },
        },
        new Set(),
      ),
    ).toEqual({
      orcid: '0000-0000-0000-001X',
      profileUrls: { orcid: 'https://orcid.org/0000-0000-0000-001X' },
      clearOrcid: false,
    });
  });
});
