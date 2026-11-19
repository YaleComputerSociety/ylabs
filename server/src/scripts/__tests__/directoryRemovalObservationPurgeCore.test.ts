import { describe, expect, it } from 'vitest';
import { buildDirectoryRemovalMatcher } from '../../services/directoryRemovalMatcher';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import {
  PURGE_CONFIRM_FLAG,
  assertPurgeApplyConfirmed,
  assertPurgeMatcherUsable,
  assertPurgeTargetMatchesEnvironment,
  parsePurgeArgs,
  planFacultyProfileRowDeletion,
  planObservationPurge,
  planPersonSubjects,
  removedResearcherIdsOf,
  resolvePurgeMongoUrl,
  rowPointerNamesRemovedPerson,
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
    directoryRemovalDigest(KEY, 'name', SHARED_NAME)!,
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
    ).toThrow(/key/);
    expect(() => assertPurgeMatcherUsable(matcher)).not.toThrow();
  });
});

describe('researcher matching', () => {
  it('matches a researcher by identifier only, never by a name entry', () => {
    expect(
      removedResearcherIdsOf(matcher, [
        { _id: 'r1', identifiers: { netid: REMOVED_NETID } },
        { _id: 'r2', identifiers: { netid: 'zz9002' } },
        { _id: 'r3', displayName: SHARED_NAME } as never,
      ]),
    ).toEqual(new Set(['r1']));
  });
});

describe('planPersonSubjects', () => {
  const context = { matcher, removedResearcherIds: new Set<string>() };
  const identityRows = [
    row({
      entityType: 'user',
      entityKey: 'dept:synthetic:removed',
      field: 'netid',
      value: REMOVED_NETID,
    }),
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
    userKeys: ['netid:zz9001', 'dept:synthetic:removed', 'netid:zz9002', 'dept:other:removed'],
    identityRows,
    linkRows,
    context,
  });

  it('removes subjects only on a stable identifier, joining the entityId form through a shared row', () => {
    expect(plan.subjectsToDelete).toEqual({ user: 2, researchGroupMember: 0 });
    expect(plan.removedNodes.has('user|i|legacy-id-1')).toBe(true);
    expect(plan.removedNodes.has('user|k|dept:other:removed')).toBe(false);
    expect(plan.removedUserKeys).toEqual(new Set(['netid:zz9001', 'dept:synthetic:removed']));
  });

  it('deletes every observation of a removed subject in both forms and the four pointer fields', () => {
    const subjectRows = [
      row({ entityType: 'user', entityKey: 'netid:zz9001', field: 'title' }),
      row({ entityType: 'user', entityId: 'legacy-id-1', field: 'bio' }),
      row({ entityType: 'user', entityKey: 'netid:zz9002', field: 'title' }),
    ];
    const pointerRows = [
      row({
        entityType: 'researchEntity',
        entityKey: 'synthetic-lab',
        field: 'inferredPiUserKey',
        value: 'dept:synthetic:removed',
      }),
      row({
        entityType: 'researchEntity',
        entityKey: 'synthetic-lab',
        field: 'contactEmail',
        value: REMOVED_EMAIL.toUpperCase(),
      }),
      row({
        entityType: 'fellowship',
        entityKey: 'synthetic-fellowship',
        field: 'contactEmail',
        value: REMOVED_EMAIL,
      }),
    ];
    const purge = planObservationPurge({
      removalEntriesActive: 3,
      personPlan: plan,
      subjectRows,
      pointerRows,
      context,
    });
    expect(purge.observationIdsToDelete).toEqual([
      subjectRows[0]._id,
      subjectRows[1]._id,
      pointerRows[0]._id,
      pointerRows[1]._id,
    ]);
    expect(purge.report.toDelete).toEqual({
      observations: 4,
      byEntityType: { user: 2, researchEntity: 2 },
      byIdentityForm: { entityKey: 3, entityId: 1, both: 0 },
      byField: {
        user: { title: 1, bio: 1 },
        researchEntity: { inferredPiUserKey: 1, contactEmail: 1 },
      },
    });
    expect(purge.rowNodesWithDeletedPointers).toEqual(new Set(['researchEntity|k|synthetic-lab']));
    expect(JSON.stringify(purge.report)).not.toMatch(/zz900|synthetic\.removed|Synthetic Removed/i);
  });
});

describe('rowPointerNamesRemovedPerson', () => {
  const context = { matcher, removedResearcherIds: new Set(['researcher-1']) };
  const names = (field: string, value: unknown) =>
    rowPointerNamesRemovedPerson(
      row({ entityType: 'researchEntity', entityKey: 'synthetic-lab', field, value }),
      context,
      new Set(),
    );

  it('names the person only through a stable pointer, never through a name', () => {
    expect(names('inferredPiUserKey', `netid:${REMOVED_NETID}`)).toBe(true);
    expect(names('inferredPiUserKey', REMOVED_EMAIL)).toBe(true);
    expect(names('inferredPiUserKey', 'netid:zz9002')).toBe(false);
    expect(names('inferredPiUserKey', `name:${SHARED_NAME}`)).toBe(false);
    expect(names('inferredPiUserId', 'researcher-1')).toBe(true);
    expect(names('contactEmail', REMOVED_EMAIL)).toBe(true);
    expect(names('contactName', SHARED_NAME)).toBe(false);
  });
});

describe('planFacultyProfileRowDeletion', () => {
  it('takes a declared profile row only when its own pointer was deleted, joining both forms', () => {
    const declaredById = row({
      entityType: 'researchEntity',
      entityId: 'row-1',
      field: 'entityType',
      value: 'FACULTY_RESEARCH_AREA',
    });
    const link = row({
      entityType: 'researchEntity',
      entityKey: 'removed-profile',
      entityId: 'row-1',
      field: 'slug',
    });
    const name = row({ entityType: 'researchEntity', entityKey: 'removed-profile', field: 'name' });
    const otherDeclared = row({
      entityType: 'researchEntity',
      entityKey: 'other-profile',
      field: 'entityType',
      value: 'FACULTY_RESEARCH_AREA',
    });
    const undeclared = row({
      entityType: 'researchEntity',
      entityKey: 'synthetic-lab',
      field: 'name',
    });
    const plan = planFacultyProfileRowDeletion({
      pointerNodes: new Set(['researchEntity|k|removed-profile', 'researchEntity|k|synthetic-lab']),
      rowObservations: [declaredById, link, name, otherDeclared, undeclared],
    });
    expect(plan.rowCount).toBe(1);
    expect(plan.observationIds.sort()).toEqual([declaredById._id, link._id, name._id].sort());
  });
});
