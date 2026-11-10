import { describe, expect, it } from 'vitest';
import { buildDirectoryRemovalMatcher } from '../../services/directoryRemovalMatcher';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import {
  PURGE_CONFIRM_FLAG,
  assertPurgeApplyConfirmed,
  assertPurgeMatcherUsable,
  assertPurgeTargetMatchesEnvironment,
  classifyRowObservation,
  parsePurgeArgs,
  planObservationPurge,
  planPersonSubjects,
  resolvePurgeMongoUrl,
  type ObservationRow,
} from '../directoryRemovalObservationPurgeCore';

const KEY = 'synthetic-directory-removal-key-0123456789';
const REMOVED_NETID = 'zz9001';
const REMOVED_EMAIL = 'synthetic.removed@example.test';
const SHARED_NAME = 'Synthetic Removed';

const matcher = buildDirectoryRemovalMatcher({
  key: KEY,
  activeDigests: [
    directoryRemovalDigest(KEY, 'netid', REMOVED_NETID)!,
    directoryRemovalDigest(KEY, 'email', REMOVED_EMAIL)!,
  ],
});

let nextId = 0;
const row = (fields: Omit<ObservationRow, '_id'>): ObservationRow => ({
  _id: `obs-${(nextId += 1)}`,
  ...fields,
});

describe('purge arguments and guards', () => {
  it('is a dry run against Development unless --apply and the confirmation are both given', () => {
    expect(parsePurgeArgs([])).toEqual({
      environment: 'development',
      apply: false,
      confirm: false,
    });
    expect(() => assertPurgeApplyConfirmed(parsePurgeArgs(['--apply']))).toThrow(
      PURGE_CONFIRM_FLAG,
    );
    expect(() =>
      assertPurgeApplyConfirmed(parsePurgeArgs(['--apply', PURGE_CONFIRM_FLAG])),
    ).not.toThrow();
  });

  it('takes no identifier and refuses an unknown environment', () => {
    expect(() => parsePurgeArgs(['--netid=zz9001'])).toThrow(/takes no identifier/);
    expect(() => parsePurgeArgs(['--environment=staging'])).toThrow(/--environment/);
    expect(parsePurgeArgs(['--environment', 'beta']).environment).toBe('beta');
  });

  it('reads each environment from its own variable and refuses a mismatched database', () => {
    const env = {
      MONGODBURL: 'mongodb://development.invalid/Development',
      BETA_MONGODBURL: 'mongodb://beta.invalid/Beta',
      PRODUCTION_MONGODBURL: 'mongodb://production.invalid/Prod',
    } as NodeJS.ProcessEnv;
    expect(resolvePurgeMongoUrl('production', env)).toContain('/Prod');
    expect(() => resolvePurgeMongoUrl('beta', {} as NodeJS.ProcessEnv)).toThrow('BETA_MONGODBURL');
    expect(() => assertPurgeTargetMatchesEnvironment('development', env.BETA_MONGODBURL!)).toThrow(
      /does not match/,
    );
    expect(() =>
      assertPurgeTargetMatchesEnvironment('production', env.PRODUCTION_MONGODBURL!),
    ).not.toThrow();
  });

  it('refuses an empty list and a keyless state', () => {
    expect(() =>
      assertPurgeMatcherUsable(buildDirectoryRemovalMatcher({ key: KEY, activeDigests: [] })),
    ).toThrow(/no active directory_removals entry/);
    expect(() =>
      assertPurgeMatcherUsable(
        buildDirectoryRemovalMatcher({
          key: undefined,
          activeDigests: ['a'.repeat(64)],
          env: {} as NodeJS.ProcessEnv,
        }),
      ),
    ).toThrow(/DIRECTORY_REMOVAL_KEY/);
    expect(() => assertPurgeMatcherUsable(matcher)).not.toThrow();
  });
});

describe('planPersonSubjects', () => {
  const identityRows = [
    row({
      entityType: 'user',
      entityKey: 'dept:synthetic:removed',
      field: 'netid',
      value: REMOVED_NETID,
    }),
    row({
      entityType: 'user',
      entityKey: 'dept:synthetic:removed',
      field: 'fname',
      value: 'Synthetic',
    }),
    row({
      entityType: 'user',
      entityKey: 'dept:synthetic:removed',
      field: 'lname',
      value: 'Removed',
    }),
    row({ entityType: 'user', entityKey: 'netid:zz9002', field: 'fname', value: 'Synthetic' }),
    row({ entityType: 'user', entityKey: 'netid:zz9002', field: 'lname', value: 'Removed' }),
    row({
      entityType: 'user',
      entityKey: 'dept:other:removed',
      field: 'fname',
      value: 'Synthetic',
    }),
    row({ entityType: 'user', entityKey: 'dept:other:removed', field: 'lname', value: 'Removed' }),
    row({
      entityType: 'user',
      entityId: 'legacy-id-1',
      field: 'profileUrls',
      value: { official: 'https://example.test/p/x' },
    }),
    row({
      entityType: 'researchGroupMember',
      entityKey: 'official-roster:synthetic-lab:1',
      field: 'profileIdentityEvidence',
      value: { emails: [REMOVED_EMAIL], netids: [], linkedProfileUrls: [], pageUrl: '' },
    }),
  ];
  const linkRows = [
    row({ entityType: 'user', entityKey: 'netid:zz9001', entityId: 'legacy-id-1', field: 'bio' }),
  ];
  const plan = planPersonSubjects({
    userKeys: [
      'netid:zz9001',
      'dept:synthetic:removed',
      'netid:zz9002',
      'dept:other:removed',
      'zz9003',
    ],
    identityRows,
    linkRows,
    matcher,
    removedResearcherIds: new Set(),
    removedResearcherNames: new Set(),
  });

  it('removes subjects only on a stable identifier, joining the entityId form through a shared row', () => {
    expect(plan.subjects.user).toEqual({
      removed: 2,
      identity_evidence_only: 0,
      name_only: 1,
      namesake: 1,
    });
    expect(plan.subjects.researchGroupMember.identity_evidence_only).toBe(1);
    expect(plan.removedSubjectsMatchedBy.user).toEqual({ netid: 2 });
    expect([...plan.judgedSubjects.user.ids]).toEqual(['legacy-id-1']);
    expect(plan.verdictByNode.get('user|i|legacy-id-1')).toBe('removed');
    expect(plan.verdictByNode.get('user|k|zz9003')).toBeUndefined();
  });

  it('deletes every observation of a removed subject in both forms and counts the rest', () => {
    const subjectRows = [
      row({ entityType: 'user', entityKey: 'netid:zz9001', field: 'title' }),
      row({ entityType: 'user', entityId: 'legacy-id-1', field: 'bio' }),
      row({ entityType: 'user', entityKey: 'netid:zz9002', field: 'title' }),
      row({ entityType: 'user', entityKey: 'dept:other:removed', field: 'title' }),
    ];
    const purge = planObservationPurge({
      removalEntriesActive: 2,
      personPlan: plan,
      subjectRows,
      rowFieldRows: [
        row({
          entityType: 'researchEntity',
          entityKey: 'synthetic-lab',
          field: 'inferredPiUserKey',
          value: 'dept:synthetic:removed',
        }),
        row({
          entityType: 'researchEntity',
          entityKey: 'synthetic-lab',
          field: 'contactName',
          value: SHARED_NAME,
        }),
      ],
      matcher,
      removedResearcherIds: new Set(),
    });
    expect(purge.observationIdsToDelete).toEqual([
      subjectRows[0]._id,
      subjectRows[1]._id,
      expect.any(String),
    ]);
    expect(purge.report.toDelete).toEqual({
      observations: 3,
      byEntityType: { user: 2, researchEntity: 1 },
      byIdentityForm: { entityKey: 2, entityId: 1, both: 0 },
      byField: { user: { title: 1, bio: 1 }, researchEntity: { inferredPiUserKey: 1 } },
    });
    expect(purge.report.leftInPlace.personObservationsBySubjectVerdict).toEqual({
      identity_evidence_only: {},
      name_only: { user: 1 },
      namesake: { user: 1 },
    });
    expect(purge.report.leftInPlace.rowObservationsByField).toEqual({
      contactName: { name_matched_left_in_place: 1 },
    });
    expect(JSON.stringify(purge.report)).not.toMatch(/zz900|synthetic\.removed|Synthetic Removed/i);
  });
});

describe('classifyRowObservation', () => {
  const context = {
    matcher,
    removedResearcherIds: new Set(['researcher-1']),
    removedNames: new Set(['synthetic removed']),
  };
  const classify = (field: string, value: unknown) =>
    classifyRowObservation(row({ entityType: 'researchEntity', field, value }), context, new Set());

  it('deletes a row observation only when its whole value is a stable pointer to the person', () => {
    expect(classify('inferredPiUserKey', `netid:${REMOVED_NETID}`)).toBe('delete');
    expect(classify('inferredPiUserKey', REMOVED_EMAIL)).toBe('delete');
    expect(classify('inferredPiUserKey', 'netid:zz9002')).toBeUndefined();
    expect(classify('inferredPiUserId', 'researcher-1')).toBe('delete');
    expect(classify('contactEmail', REMOVED_EMAIL.toUpperCase())).toBe('delete');
  });

  it('leaves name-only and multi-person values in place', () => {
    expect(classify('inferredDirectorUserName', { fname: 'Synthetic', lname: 'Removed' })).toBe(
      'name_matched_left_in_place',
    );
    expect(
      classify('rosterEnrichment', {
        undergraduates: [{ name: 'Synthetic Peer' }, { name: SHARED_NAME }],
      }),
    ).toBe('name_matched_left_in_place');
    expect(classify('fellowshipRecipients', [{ studentName: 'Synthetic Peer' }])).toBeUndefined();
  });
});
