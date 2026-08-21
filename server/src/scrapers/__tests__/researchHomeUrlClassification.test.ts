import { describe, expect, it } from 'vitest';
import {
  isProfileOrDirectoryPageUrl,
  resolveSourceUrlResearchHomeUrl,
} from '../utils/researchHomeUrlClassification';

describe('isProfileOrDirectoryPageUrl', () => {
  it('flags profile and directory listing pages regardless of host', () => {
    expect(isProfileOrDirectoryPageUrl('https://medicine.yale.edu/profile/pat-fixture/')).toBe(true);
    expect(isProfileOrDirectoryPageUrl('https://medicine.yale.edu/cancer/profile/pat-fixture')).toBe(
      true,
    );
    expect(
      isProfileOrDirectoryPageUrl(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
      ),
    ).toBe(true);
    expect(isProfileOrDirectoryPageUrl('https://english.yale.edu/people/kai-fixture/')).toBe(true);
    expect(
      isProfileOrDirectoryPageUrl('https://environment.yale.edu/directory/faculty/sam-fixture/'),
    ).toBe(true);
    expect(isProfileOrDirectoryPageUrl('https://wti.yale.edu/humans/faculty')).toBe(true);
    expect(isProfileOrDirectoryPageUrl('https://rs.yale.edu/node/1/reees-people/')).toBe(true);
  });

  it('does not flag real lab and research-home sites', () => {
    expect(isProfileOrDirectoryPageUrl('https://synthlab.yale.edu/')).toBe(false);
    expect(isProfileOrDirectoryPageUrl('https://synthlab.example.org/team')).toBe(false);
    expect(isProfileOrDirectoryPageUrl('https://campuspress.yale.edu/synthlab/')).toBe(false);
  });

  it('does not flag campuspress personal-microsite lab pages using a people path', () => {
    expect(
      isProfileOrDirectoryPageUrl('https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/'),
    ).toBe(false);
    expect(
      isProfileOrDirectoryPageUrl('https://campuspress.yale.edu/squirrel/people/elena-gracheva-lab/'),
    ).toBe(false);
  });

  it('returns false for non-URL and non-http-parseable input', () => {
    expect(isProfileOrDirectoryPageUrl('')).toBe(false);
    expect(isProfileOrDirectoryPageUrl(undefined)).toBe(false);
    expect(isProfileOrDirectoryPageUrl('not a url')).toBe(false);
  });
});

describe('resolveSourceUrlResearchHomeUrl', () => {
  it('accepts and canonicalizes real lab and personal research-home sites', () => {
    expect(resolveSourceUrlResearchHomeUrl('https://synthlab.yale.edu')).toBe(
      'https://synthlab.yale.edu/',
    );
    expect(resolveSourceUrlResearchHomeUrl('https://campuspress.yale.edu/synthlab/')).toBe(
      'https://campuspress.yale.edu/synthlab/',
    );
    expect(resolveSourceUrlResearchHomeUrl('https://synthpi.example.org/team')).toBe(
      'https://synthpi.example.org/team/',
    );
  });

  it('is idempotent on the canonical campuspress lab research homes it produces', () => {
    const canonical = 'https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/';
    expect(resolveSourceUrlResearchHomeUrl('https://slavlab.yale.edu/')).toBe(canonical);
    expect(resolveSourceUrlResearchHomeUrl(canonical)).toBe(canonical);
  });

  it('rejects profile pages, generic listings, and non-site hosts', () => {
    expect(resolveSourceUrlResearchHomeUrl('https://medicine.yale.edu/profile/pat-fixture/')).toBe(
      '',
    );
    expect(
      resolveSourceUrlResearchHomeUrl('https://medicine.yale.edu/cancer/research/membership/directory'),
    ).toBe('');
    expect(
      resolveSourceUrlResearchHomeUrl(
        'https://psychology.yale.edu/diversity/research-opportunities-undergraduates',
      ),
    ).toBe('');
    expect(resolveSourceUrlResearchHomeUrl('https://drive.google.com/open/')).toBe('');
    expect(resolveSourceUrlResearchHomeUrl('https://docs.google.com/document/d/abc/edit')).toBe('');
    expect(resolveSourceUrlResearchHomeUrl('https://reporter.nih.gov/project-details/1')).toBe('');
  });
});
