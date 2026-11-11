import { describe, expect, it } from 'vitest';
import {
  changedResearcherPaths,
  expandUserMaterializerScope,
  parseUserOnlyFieldsList,
  partitionPlannedPaths,
  scopedResearcherUpdate,
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
      scopedResearcherUpdate({ profile: { title: 'Professor' }, identifiers: {} }, [
        'profile.title',
        'identifiers.email',
      ]),
    ).toEqual({ $set: { 'profile.title': 'Professor' }, $unset: { 'identifiers.email': '' } });
  });
});
