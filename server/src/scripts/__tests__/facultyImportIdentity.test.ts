import { describe, expect, it } from 'vitest';
import {
  findCollidingFacultyImportOrcids,
  safeFacultyImportEmail,
  safeFacultyImportExternalIdentity,
} from '../facultyImportIdentity';

describe('faculty import identity guards', () => {
  it('replaces a wrong-person name-shaped email with the verified NetID address', () => {
    expect(
      safeFacultyImportEmail({
        netid: 'jz947',
        name: 'Jonathan Zimmerman',
        email: 'julie.zimmerman@yale.edu',
      }),
    ).toBe('jz947@yale.edu');
  });

  it('keeps a person-specific Yale email and normalizes mailto casing', () => {
    expect(
      safeFacultyImportEmail({
        netid: 'xz739',
        name: 'Xiangyu Zhang',
        email: 'MAILTO:Xiangyu.Zhang@yale.edu',
      }),
    ).toBe('xiangyu.zhang@yale.edu');
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
    ).toEqual({ profileUrls: { yale: 'https://example.yale.edu/profile/first-person' } });
  });

  it('preserves a unique ORCID and unrelated profile URLs', () => {
    expect(
      safeFacultyImportExternalIdentity(
        {
          netid: 'one1',
          name: 'First Person',
          orcid: '0000-0001-1111-1111',
          profileUrls: { orcid: 'https://orcid.org/0000-0001-1111-1111' },
        },
        new Set(),
      ),
    ).toEqual({
      orcid: '0000-0001-1111-1111',
      profileUrls: { orcid: 'https://orcid.org/0000-0001-1111-1111' },
    });
  });
});
