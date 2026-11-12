import { describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import {
  changedResearcherPaths,
  expandUserMaterializerScope,
  parseUserOnlyFieldsList,
  partitionPlannedPaths,
  scopedResearcherUpdate,
  withoutRepeatedParentPaths,
} from '../userMaterializerFieldScope';

describe('user materializer field scope (#5816)', () => {
  it('canonicalizes aliases and refuses an unsupported field', () => {
    expect(parseUserOnlyFieldsList('email, primaryDepartment,imageUrl,websiteUrl,title')).toEqual([
      'identifiers.email',
      'profile.primaryDepartment',
      'profile.imageUrl',
      'profile.websiteUrl',
      'profile.title',
    ]);
    expect(parseUserOnlyFieldsList('displayName,displayName,profileFieldWriters')).toEqual([
      'displayName',
      'profileFieldWriters',
    ]);
    expect(() => parseUserOnlyFieldsList('identifiers.netid')).toThrow(
      /Unsupported --only-fields field: identifiers\.netid/,
    );
    expect(() => parseUserOnlyFieldsList('status')).toThrow(/Unsupported/);
    expect(() => parseUserOnlyFieldsList('')).toThrow(/requires/);
    expect(() => parseUserOnlyFieldsList(' , ')).toThrow(/at least one/);
  });

  it('writes an email with its support marker in either direction', () => {
    expect(expandUserMaterializerScope(['email'])).toEqual([
      'identifiers.email',
      'identifiers.emailSupport',
    ]);
    expect(expandUserMaterializerScope(['identifiers.emailSupport'])).toEqual([
      'identifiers.email',
      'identifiers.emailSupport',
    ]);
  });

  it('pulls in a display value own writer record and never the reverse', () => {
    expect(expandUserMaterializerScope(['title'])).toEqual([
      'profile.title',
      'profileFieldWriters.title',
    ]);
    expect(expandUserMaterializerScope(['profileFieldWriters'])).toEqual(['profileFieldWriters']);
    expect(expandUserMaterializerScope(['profileFieldWriters.title'])).toEqual([
      'profileFieldWriters.title',
    ]);
  });

  it('reports changed paths at scope granularity and partitions them', () => {
    const before = {
      _id: 'x',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      displayName: 'A. Synthetic',
      profile: { title: 'Lecturer' },
      identifiers: { netid: 'zz5816a' },
      profileLinks: [],
    };
    const after = {
      _id: 'x',
      updatedAt: new Date('2026-02-01T00:00:00Z'),
      displayName: 'Avery Synthetic',
      profile: { title: 'Lecturer', primaryDepartment: 'Fixture Studies' },
      identifiers: { netid: 'zz5816a', email: 'avery.synthetic5816@yale.edu' },
      profileLinks: [],
      profileFieldWriters: { primaryDepartment: { userKey: 'netid:zz5816a', joinRank: 4 } },
    };
    const changed = changedResearcherPaths(before, after);
    expect(changed).toEqual([
      'displayName',
      'identifiers.email',
      'profile.primaryDepartment',
      'profileFieldWriters.primaryDepartment',
    ]);
    expect(
      partitionPlannedPaths(changed, expandUserMaterializerScope(['primaryDepartment'])),
    ).toEqual({
      kept: ['profile.primaryDepartment', 'profileFieldWriters.primaryDepartment'],
      dropped: ['displayName', 'identifiers.email'],
    });
    expect(changedResearcherPaths(before, { ...before, profile: { title: 'Lecturer' } })).toEqual(
      [],
    );
  });

  it('builds an update that sets and unsets exactly the kept paths', () => {
    expect(
      scopedResearcherUpdate({}, { profile: { title: 'Professor' }, identifiers: {} }, [
        'profile.title',
        'identifiers.email',
      ]),
    ).toEqual({ $set: { 'profile.title': 'Professor' }, $unset: { 'identifiers.email': '' } });
  });
});

describe('user materializer ORCID scope (#5711, #5991)', () => {
  const link = (kind: string, url: string) => ({ kind, purpose: 'SCHOLARLY', url });
  const official = link('YALE_OFFICIAL', 'https://fixture6001.example.edu/people/a');
  const scholar = link('GOOGLE_SCHOLAR', 'https://scholar.google.com/citations?user=zz6001');
  const yearRun = link('ORCID', 'https://orcid.org/2025-2024-2023-2022');

  it('accepts orcid and always writes it with its profile link', () => {
    expect(parseUserOnlyFieldsList('orcid')).toEqual(['identifiers.orcid']);
    expect(expandUserMaterializerScope(['orcid'])).toEqual([
      'identifiers.orcid',
      'profileLinks.ORCID',
    ]);
    expect(expandUserMaterializerScope(['profileLinks'])).toEqual(['profileLinks']);
  });

  it('reports an ORCID link change apart from the other links', () => {
    const before = {
      identifiers: { orcid: '2025-2024-2023-2022' },
      profileLinks: [official, yearRun],
    };
    expect(changedResearcherPaths(before, { identifiers: {}, profileLinks: [official] })).toEqual([
      'identifiers.orcid',
      'profileLinks.ORCID',
    ]);
    expect(
      changedResearcherPaths(before, { ...before, profileLinks: [official, scholar, yearRun] }),
    ).toEqual(['profileLinks']);
  });

  it('replaces only the ORCID entries of the stored links', () => {
    const before = { identifiers: { orcid: 'x' }, profileLinks: [official, yearRun, scholar] };
    const after = { identifiers: {}, profileLinks: [official, link('YALE_OFFICIAL', 'other')] };
    expect(
      scopedResearcherUpdate(before, after, ['identifiers.orcid', 'profileLinks.ORCID']),
    ).toEqual({ $set: { profileLinks: [official, scholar] }, $unset: { 'identifiers.orcid': '' } });
    const replaced = link('ORCID', 'https://orcid.org/replacement');
    expect(
      scopedResearcherUpdate(before, { profileLinks: [scholar, replaced] }, ['profileLinks.ORCID']),
    ).toEqual({ $set: { profileLinks: [official, replaced, scholar] } });
    expect(scopedResearcherUpdate(before, after, ['profileLinks', 'profileLinks.ORCID'])).toEqual({
      $set: { profileLinks: after.profileLinks },
    });
  });
});

describe('a dry-run report never shows a path no write makes', () => {
  it('drops the repeated parent segment Mongoose reports for a newly set nested subdocument', () => {
    const researcher: any = Researcher.hydrate({
      _id: '64b000000000000000006001',
      displayName: 'A. Synthetic',
      profileLinks: [],
      identifiers: { email: 'avery.synthetic6001@yale.edu' },
    });
    researcher.set('identifiers.emailSupport', {
      supported: true,
      sources: ['dept-faculty-roster'],
      computedForEmail: 'avery.synthetic6001@yale.edu',
    });
    const reported = withoutRepeatedParentPaths(researcher.modifiedPaths());
    expect(reported).toContain('identifiers.emailSupport');
    expect(reported.filter((path) => path.startsWith('identifiers.identifiers'))).toEqual([]);
    expect(withoutRepeatedParentPaths(['profile', 'profile.title', 'a.b.a'])).toEqual([
      'profile',
      'profile.title',
      'a.b.a',
    ]);
  });
});
