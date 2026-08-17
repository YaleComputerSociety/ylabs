import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Account, type AccountRecord } from '../../models/account';
import { Person, type PersonRecord } from '../../models/person';
import { RoleAssignment, type RoleAssignmentRecord } from '../../models/roleAssignment';

type WithObjectId<T> = T & { _id: mongoose.Types.ObjectId };
import {
  assertPhase2IdentityMigrationApplyAllowed,
  buildCanonicalWriteDocuments,
  parsePhase2IdentityMigrationApplyArgs,
} from '../phase2IdentityMigrationApplyCore';
import { applyPhase2IdentityMigration } from '../phase2IdentityMigrationApply';

describe('phase2IdentityMigrationApply CLI arguments', () => {
  it('defaults to a dry-run and parses bounded options', () => {
    const outputPath = path.join(os.tmpdir(), 'phase2-identity-apply.json');
    expect(parsePhase2IdentityMigrationApplyArgs(['--environment=development'])).toEqual({
      environment: 'development',
      apply: false,
      confirm: false,
      documentLimit: 100_000,
      quarantineLimit: 25_000,
    });
    expect(
      parsePhase2IdentityMigrationApplyArgs([
        '--environment=beta',
        '--apply',
        '--confirm-identity-migration-apply',
        '--document-limit=500',
        '--quarantine-limit=100',
        `--output=${outputPath}`,
      ]),
    ).toEqual({
      environment: 'beta',
      apply: true,
      confirm: true,
      documentLimit: 500,
      quarantineLimit: 100,
      output: outputPath,
    });
  });

  it('rejects Production, malformed, and unknown arguments', () => {
    expect(() =>
      parsePhase2IdentityMigrationApplyArgs(['--environment=production']),
    ).toThrow(/development, beta, or production-copy/);
    expect(() => parsePhase2IdentityMigrationApplyArgs([])).toThrow(/--environment requires/);
    expect(() =>
      parsePhase2IdentityMigrationApplyArgs([
        '--environment=development',
        '--confirm-identity-migration-apply=1',
      ]),
    ).toThrow(/does not accept a value/);
    expect(() =>
      parsePhase2IdentityMigrationApplyArgs(['--environment=development', '--nope']),
    ).toThrow(/Unknown model-refactor:identity-apply option/);
    expect(() =>
      parsePhase2IdentityMigrationApplyArgs([
        '--environment=development',
        '--document-limit=1000001',
      ]),
    ).toThrow(/no greater than 1000000/);
  });

  it('requires the confirmation flag before an apply', () => {
    expect(() =>
      assertPhase2IdentityMigrationApplyAllowed({ apply: true, confirm: false }),
    ).toThrow(/--confirm-identity-migration-apply is required/);
    expect(() =>
      assertPhase2IdentityMigrationApplyAllowed({ apply: true, confirm: true }),
    ).not.toThrow();
    expect(() =>
      assertPhase2IdentityMigrationApplyAllowed({ apply: false, confirm: false }),
    ).not.toThrow();
  });
});

describe('buildCanonicalWriteDocuments key resolution', () => {
  it('resolves synthetic linking keys into ObjectId references', () => {
    const researchEntityId = new mongoose.Types.ObjectId().toString();
    let counter = 0;
    const objectIdFactory = () =>
      new mongoose.Types.ObjectId(String(counter++).padStart(24, '0'));

    const documents = buildCanonicalWriteDocuments(
      {
        plannedAccounts: [
          {
            accountKey: 'account:user:u1',
            sourceUserId: 'u1',
            netid: 'jdoe',
            email: 'jane.doe@yale.edu',
            status: 'ACTIVE',
          },
        ],
        plannedPeople: [
          {
            personKey: 'person:user:u1',
            sourceUserIds: ['u1'],
            sourceFacultyMemberIds: [],
            displayName: 'Jane Doe',
            accountKey: 'account:user:u1',
            yaleEvidence: ['NETID', 'YALE_EMAIL'],
            externalIdentityHints: [],
          },
          {
            personKey: 'person:faculty_member:f1',
            sourceUserIds: [],
            sourceFacultyMemberIds: ['f1'],
            displayName: 'Sam Carter',
            yaleEvidence: ['YALE_EMAIL'],
            externalIdentityHints: [],
          },
        ],
        plannedRoleAssignments: [
          {
            roleAssignmentKey: 'role_assignment:membership:m1',
            sourceMembershipId: 'm1',
            personKey: 'person:user:u1',
            researchEntityId,
            role: 'PI',
            state: 'CURRENT',
            confidence: 0.9,
            reviewStatus: 'APPROVED',
            resolution: 'CANONICAL_SOURCE_REFERENCE',
          },
          {
            roleAssignmentKey: 'role_assignment:membership:m2',
            sourceMembershipId: 'm2',
            personKey: 'person:faculty_member:f1',
            researchEntityId,
            role: 'DIRECTOR',
            state: 'HISTORICAL',
            endedAt: '2020-01-01T00:00:00.000Z',
            confidence: 0.5,
            reviewStatus: 'UNREVIEWED',
            resolution: 'CANONICAL_SOURCE_REFERENCE',
          },
        ],
      },
      objectIdFactory,
    );

    const accountedPerson = documents.people.find((person) => person.accountId);
    expect(accountedPerson?.accountId?.toString()).toBe(documents.accounts[0]._id.toString());
    expect(documents.people.find((person) => !person.accountId)?.displayName).toBe('Sam Carter');

    const pi = documents.roleAssignments.find((role) => role.role === 'PI');
    expect(pi?.personId.toString()).toBe(accountedPerson?._id.toString());
    expect(pi?.target).toEqual({ kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(researchEntityId) });
    expect(pi?.endedAt).toBeUndefined();

    const director = documents.roleAssignments.find((role) => role.role === 'DIRECTOR');
    expect(director?.state).toBe('HISTORICAL');
    expect(director?.endedAt).toEqual(new Date('2020-01-01T00:00:00.000Z'));
  });

  it('fails closed when a role references an unknown person key', () => {
    expect(() =>
      buildCanonicalWriteDocuments({
        plannedAccounts: [],
        plannedPeople: [],
        plannedRoleAssignments: [
          {
            roleAssignmentKey: 'role_assignment:membership:m1',
            sourceMembershipId: 'm1',
            personKey: 'person:user:missing',
            researchEntityId: new mongoose.Types.ObjectId().toString(),
            role: 'PI',
            state: 'UNKNOWN',
            confidence: 0.1,
            reviewStatus: 'UNREVIEWED',
            resolution: 'CANONICAL_SOURCE_REFERENCE',
          },
        ],
      }),
    ).toThrow(/could not resolve personKey/);
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('phase2IdentityMigrationApply with MongoDB', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('phase2_identity_apply_test'));
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  async function seedLegacyIdentitySources(): Promise<{
    userId: mongoose.Types.ObjectId;
    facultyId: mongoose.Types.ObjectId;
    researchEntityId: mongoose.Types.ObjectId;
  }> {
    const db = mongoose.connection.db!;
    const userId = new mongoose.Types.ObjectId();
    const facultyId = new mongoose.Types.ObjectId();
    const researchEntityId = new mongoose.Types.ObjectId();

    await db.collection('research_entities').insertOne({ _id: researchEntityId, name: 'Doe Lab' });
    await db.collection('users').insertOne({
      _id: userId,
      netid: 'jdoe',
      email: 'jane.doe@yale.edu',
      userType: 'professor',
      fname: 'Jane',
      lname: 'Doe',
      loginCount: 3,
      archived: false,
    });
    await db.collection('faculty_members').insertOne({
      _id: facultyId,
      netid: 'scarter',
      email: 'sam.carter@yale.edu',
      name: 'Sam Carter',
      archived: false,
    });
    await db.collection('research_entity_members').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        userId,
        researchEntityId,
        role: 'pi',
        isCurrentMember: true,
        evidenceStatus: 'verified',
        confidence: 0.9,
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        facultyMemberId: facultyId,
        researchEntityId,
        role: 'director',
        isCurrentMember: false,
        confidence: 0.5,
        archived: false,
      },
    ]);

    return { userId, facultyId, researchEntityId };
  }

  const applyArgs = {
    environment: 'development' as const,
    databaseName: 'development',
    sourceCommit: 'test',
    documentLimit: 1000,
    quarantineLimit: 1000,
  };

  it('performs no writes in dry-run mode', async () => {
    await seedLegacyIdentitySources();
    const report = await applyPhase2IdentityMigration({ apply: false, ...applyArgs });

    expect(report.mode).toBe('dry-run');
    expect(report.planned).toMatchObject({ accounts: 1, people: 2, roleAssignments: 2 });
    expect(report.written).toEqual({ accounts: 0, people: 0, roleAssignments: 0 });
    await expect(Account.countDocuments({})).resolves.toBe(0);
    await expect(Person.countDocuments({})).resolves.toBe(0);
    await expect(RoleAssignment.countDocuments({})).resolves.toBe(0);
  });

  it('writes canonical identity documents with correct references and is idempotent', async () => {
    const seed = await seedLegacyIdentitySources();
    const first = await applyPhase2IdentityMigration({ apply: true, ...applyArgs });

    expect(first.mode).toBe('apply');
    expect(first.written).toEqual({ accounts: 1, people: 2, roleAssignments: 2 });

    const account = await Account.findOne({ netid: 'jdoe' }).lean<WithObjectId<AccountRecord>>();
    expect(account).not.toBeNull();
    expect(account?.email).toBe('jane.doe@yale.edu');
    expect(account?.status).toBe('ACTIVE');

    const accountedPerson = await Person.findOne({ displayName: 'Jane Doe' }).lean<
      WithObjectId<PersonRecord>
    >();
    const facultyPerson = await Person.findOne({ displayName: 'Sam Carter' }).lean<
      WithObjectId<PersonRecord>
    >();
    expect(accountedPerson?.accountId?.toString()).toBe(account?._id.toString());
    expect(facultyPerson?.accountId).toBeUndefined();

    const piRole = await RoleAssignment.findOne({ role: 'PI' }).lean<
      WithObjectId<RoleAssignmentRecord>
    >();
    expect(piRole?.personId.toString()).toBe(accountedPerson?._id.toString());
    expect(piRole?.target.id.toString()).toBe(seed.researchEntityId.toString());
    expect(piRole?.state).toBe('CURRENT');
    expect(piRole?.reviewStatus).toBe('APPROVED');
    expect(piRole?.confidence).toBe(0.9);

    const directorRole = await RoleAssignment.findOne({ role: 'DIRECTOR' }).lean<
      WithObjectId<RoleAssignmentRecord>
    >();
    expect(directorRole?.personId.toString()).toBe(facultyPerson?._id.toString());
    expect(directorRole?.state).toBe('HISTORICAL');

    const second = await applyPhase2IdentityMigration({ apply: true, ...applyArgs });
    expect(second.written).toEqual({ accounts: 1, people: 2, roleAssignments: 2 });
    await expect(Account.countDocuments({})).resolves.toBe(1);
    await expect(Person.countDocuments({})).resolves.toBe(2);
    await expect(RoleAssignment.countDocuments({})).resolves.toBe(2);
  });
});
