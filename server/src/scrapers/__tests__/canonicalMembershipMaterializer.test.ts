import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account, AccountRecord } from '../../models/account';
import { Researcher, ResearcherRecord } from '../../models/researcher';
import { RoleAssignment, RoleAssignmentRecord } from '../../models/roleAssignment';
import {
  canonicalRoleForLegacy,
  reviewStatusForLegacyMembership,
  roleStateForLegacyMembership,
} from '../../models/canonicalRoleMapping';
import {
  archiveCanonicalRoleAssignmentsForPersons,
  archiveSupersededCanonicalRoleAssignments,
  buildCanonicalRoleAssignmentUpsert,
  identityIsOrganizationalMailbox,
  materializeCanonicalMembership,
  resolveCanonicalResearcherId,
  resolveOrCreateResearcherIdForIdentity,
} from '../canonicalMembershipMaterializer';
import { getResearchEntityRoster } from '../../services/researchEntityMembershipAccessor';

type WithObjectId<T> = T & { _id: mongoose.Types.ObjectId };

describe('canonical membership mapping (pure)', () => {
  it('maps legacy roles to canonical roles and returns undefined for unmapped', () => {
    expect(canonicalRoleForLegacy('pi')).toBe('PI');
    expect(canonicalRoleForLegacy('co-director')).toBe('CO_DIRECTOR');
    expect(canonicalRoleForLegacy('alumni')).toBe('AFFILIATED');
    expect(canonicalRoleForLegacy('grad-student')).toBe('GRADUATE_STUDENT');
    expect(canonicalRoleForLegacy('nonsense')).toBeUndefined();
    expect(canonicalRoleForLegacy(undefined)).toBeUndefined();
  });

  it('derives role state mirroring the batch', () => {
    expect(
      roleStateForLegacyMembership({ evidenceStatus: 'verified', isCurrentMember: true }),
    ).toBe('CURRENT');
    expect(
      roleStateForLegacyMembership({ evidenceStatus: 'verified', isCurrentMember: false }),
    ).toBe('HISTORICAL');
    expect(roleStateForLegacyMembership({ role: 'alumni', isCurrentMember: true })).toBe(
      'HISTORICAL',
    );
    expect(roleStateForLegacyMembership({ isCurrentMember: true })).toBe('UNKNOWN');
  });

  it('grants APPROVED only for a canonical-source-referenced current verified membership', () => {
    expect(
      reviewStatusForLegacyMembership(
        { archived: false, evidenceStatus: 'verified' },
        'CURRENT',
        'CANONICAL_SOURCE_REFERENCE',
      ),
    ).toBe('APPROVED');
    expect(
      reviewStatusForLegacyMembership(
        { archived: false, evidenceStatus: 'verified' },
        'CURRENT',
        undefined,
      ),
    ).toBe('UNREVIEWED');
    expect(
      reviewStatusForLegacyMembership(
        { archived: false, evidenceStatus: 'verified' },
        'UNKNOWN',
        'CANONICAL_SOURCE_REFERENCE',
      ),
    ).toBe('UNREVIEWED');
  });

  it('flags organizational and department mailbox identities but not individuals (#887)', () => {
    expect(
      identityIsOrganizationalMailbox({ netid: 'physics', email: 'physics@example.test' }),
    ).toBe(true);
    expect(identityIsOrganizationalMailbox({ email: 'info@example.test' })).toBe(true);
    expect(identityIsOrganizationalMailbox({ email: 'no-reply@example.test' })).toBe(true);
    expect(identityIsOrganizationalMailbox({ netid: 'chemistry' })).toBe(true);
    expect(identityIsOrganizationalMailbox({ email: 'econ-dept@example.test' })).toBe(true);
    expect(identityIsOrganizationalMailbox({ email: 'sloan-lab@example.test' })).toBe(true);

    expect(identityIsOrganizationalMailbox({ netid: 'ab123', email: 'ab123@example.test' })).toBe(
      false,
    );
    expect(
      identityIsOrganizationalMailbox({ netid: 'javery', email: 'jordan.avery@example.test' }),
    ).toBe(false);
    expect(identityIsOrganizationalMailbox({ displayName: 'Physics Person' })).toBe(false);
  });

  it('builds an idempotent role-assignment upsert and toggles endedAt by state', () => {
    const personId = new mongoose.Types.ObjectId();
    const entityId = new mongoose.Types.ObjectId();
    const current = buildCanonicalRoleAssignmentUpsert(personId, entityId, 'pi', {
      state: 'CURRENT',
      confidence: 1.5,
      reviewStatus: 'APPROVED',
    });
    expect(current?.filter).toEqual({
      personId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityId,
      role: 'PI',
    });
    expect((current?.update as any).$set.confidence).toBe(1);
    expect((current?.update as any).$unset).toEqual({ endedAt: '' });

    const ended = new Date('2020-01-01T00:00:00.000Z');
    const historical = buildCanonicalRoleAssignmentUpsert(personId, entityId, 'postdoc', {
      state: 'HISTORICAL',
      confidence: 0.4,
      reviewStatus: 'UNREVIEWED',
      endedAt: ended,
    });
    expect((historical?.update as any).$set.endedAt).toBe(ended);
    expect((historical?.update as any).$unset).toBeUndefined();

    expect(
      buildCanonicalRoleAssignmentUpsert(personId, entityId, 'nonsense', {
        state: 'CURRENT',
        confidence: 1,
        reviewStatus: 'UNREVIEWED',
      }),
    ).toBeNull();
  });
});

describe('canonical membership materialization (integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['accounts', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const entityId = () => new mongoose.Types.ObjectId().toString();
  const ORCID = '9999-9999-9999-9994';

  it('creates an Account, Researcher, and CURRENT RoleAssignment for a netid-backed member', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'pi',
        displayName: 'Alpha One',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.9,
      },
      {
        netid: 'ab123',
        email: 'ab123@example.test',
        displayName: 'Alpha One',
        hasCanonicalSourceReference: true,
      },
    );
    const account = await Account.findOne({ netid: 'ab123' }).lean<WithObjectId<AccountRecord>>();
    expect(account).toBeTruthy();
    const researcher = await Researcher.findOne({ accountId: account?._id }).lean<
      WithObjectId<ResearcherRecord>
    >();
    expect(researcher?.displayName).toBe('Alpha One');
    const assignments = await RoleAssignment.find({
      'target.id': new mongoose.Types.ObjectId(id),
    }).lean();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].role).toBe('PI');
    expect(assignments[0].state).toBe('CURRENT');
    expect(assignments[0].reviewStatus).toBe('APPROVED');
  });

  it('materializes a lead for a vanity netid that is not the letters-then-digits shape', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'pi',
        displayName: 'Zeta Vanity',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.9,
      },
      {
        netid: 'zvanity',
        email: 'zvanity@example.test',
        displayName: 'Zeta Vanity',
        hasCanonicalSourceReference: true,
      },
    );
    const account = await Account.findOne({ netid: 'zvanity' }).lean<WithObjectId<AccountRecord>>();
    expect(account).toBeTruthy();
    const assignments = await RoleAssignment.find({
      'target.id': new mongoose.Types.ObjectId(id),
    }).lean();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].role).toBe('PI');
    expect(assignments[0].state).toBe('CURRENT');
  });

  it('fails closed: never mints an Account/Researcher for a department-mailbox identity (#887)', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'pi',
        displayName: 'Physics',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.9,
      },
      {
        netid: 'physics',
        email: 'physics@example.test',
        displayName: 'Physics',
        hasCanonicalSourceReference: true,
      },
    );
    expect(await Account.countDocuments({})).toBe(0);
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(
      await RoleAssignment.countDocuments({ 'target.id': new mongoose.Types.ObjectId(id) }),
    ).toBe(0);
  });

  it('never treats a separator-bearing shell key as an account netid', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'pi',
        displayName: 'Shell Key Person',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.5,
      },
      {
        netid: 'dept:econ:shell-key',
        email: 'shell-key@example.test',
        displayName: 'Shell Key Person',
        hasCanonicalSourceReference: true,
      },
    );
    expect(await Account.countDocuments({ netid: 'dept:econ:shell-key' })).toBe(0);
  });

  it('surfaces a continuously-written member through getResearchEntityRoster without the batch', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'pi',
        displayName: 'Roster Member',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.95,
      },
      {
        netid: 'gh456',
        email: 'gh456@example.test',
        displayName: 'Roster Member',
        hasCanonicalSourceReference: true,
      },
    );
    const roster = await getResearchEntityRoster(new mongoose.Types.ObjectId(id));
    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe('Roster Member');
    expect(roster[0].role).toBe('pi');
    expect(roster[0].isCurrentMember).toBe(true);
    expect(roster[0].netid).toBe('gh456');
  });

  it('persists ISO-string roster provenance dates as Date instances surfaced by the accessor', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'staff',
        displayName: 'Provenance Member',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.95,
        rosterProvenance: {
          sourceName: 'official-research-home-roster',
          sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
          membershipKey: 'official-profile:provenance-member|staff',
          evidenceStatus: 'verified',
          observedAt: '2026-08-14T00:00:00.000Z',
          freshnessExpiresAt: '2999-01-01T00:00:00.000Z',
        } as unknown as RoleAssignmentRecord['rosterProvenance'],
      },
      {
        netid: 'pm789',
        email: 'pm789@example.test',
        displayName: 'Provenance Member',
        hasCanonicalSourceReference: true,
      },
    );
    const assignment = await RoleAssignment.findOne({
      'target.id': new mongoose.Types.ObjectId(id),
    }).lean<WithObjectId<RoleAssignmentRecord>>();
    expect(assignment?.rosterProvenance?.freshnessExpiresAt).toBeInstanceOf(Date);
    expect(assignment?.rosterProvenance?.observedAt).toBeInstanceOf(Date);
    expect(assignment?.rosterProvenance?.freshnessExpiresAt?.toISOString()).toBe(
      '2999-01-01T00:00:00.000Z',
    );

    const roster = await getResearchEntityRoster(new mongoose.Types.ObjectId(id));
    expect(roster).toHaveLength(1);
    expect(roster[0].rosterProvenance?.freshnessExpiresAt).toBeInstanceOf(Date);
    expect((roster[0].rosterProvenance?.freshnessExpiresAt as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('is idempotent: re-running produces exactly one Researcher and one RoleAssignment', async () => {
    const id = entityId();
    const facts = {
      legacyRole: 'pi',
      displayName: 'Beta Two',
      evidenceStatus: 'verified',
      isCurrentMember: true,
      confidence: 0.8,
    };
    const identity = {
      netid: 'cd234',
      email: 'cd234@example.test',
      displayName: 'Beta Two',
      hasCanonicalSourceReference: true,
    };
    await materializeCanonicalMembership(id, facts, identity);
    await materializeCanonicalMembership(id, facts, identity);
    expect(await Researcher.countDocuments({})).toBe(1);
    expect(await RoleAssignment.countDocuments({})).toBe(1);
  });

  it('resolves by ORCID and skips the write on an accountId conflict (never merges)', async () => {
    const conflictingAccountId = new mongoose.Types.ObjectId();
    await Researcher.create({
      displayName: 'Gamma Three',
      accountId: conflictingAccountId,
      identifiers: { orcid: ORCID },
      profileLinks: [],
      archived: false,
    });
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'postdoc',
        displayName: 'Different Name',
        isCurrentMember: true,
        confidence: 0.5,
      },
      { orcid: ORCID, displayName: 'Different Name' },
    );
    // ORCID belongs to an account-backed researcher: fail closed, no new researcher, no assignment.
    expect(await Researcher.countDocuments({})).toBe(1);
    expect(await RoleAssignment.countDocuments({})).toBe(0);
  });

  it('reuses a single name-only researcher but never merges onto an identified one', async () => {
    const id = entityId();
    await Researcher.create({ displayName: 'Delta Four', profileLinks: [], archived: false });
    await materializeCanonicalMembership(
      id,
      { legacyRole: 'staff', displayName: 'Delta Four', isCurrentMember: true, confidence: 0.5 },
      { displayName: 'Delta Four' },
    );
    expect(await Researcher.countDocuments({ displayName: 'Delta Four' })).toBe(1);
    expect(await RoleAssignment.countDocuments({})).toBe(1);
  });

  it('creates only one name-only researcher when the same identity resolves concurrently', async () => {
    const identity = { displayName: 'Concurrent Name-Only Person' };
    const ids = await Promise.all(
      Array.from({ length: 16 }, () => resolveOrCreateResearcherIdForIdentity(identity)),
    );
    const resolved = ids.filter(Boolean).map((id) => id!.toString());
    expect(resolved).toHaveLength(16);
    expect(new Set(resolved).size).toBe(1);
    expect(await Researcher.countDocuments({ displayName: 'Concurrent Name-Only Person' })).toBe(1);
  });

  it('does not create a new researcher on each run when a name-only member collides with an identified one', async () => {
    const id = entityId();
    await Researcher.create({
      displayName: 'Zeta Six',
      accountId: new mongoose.Types.ObjectId(),
      profileLinks: [],
      archived: false,
    });
    const facts = {
      legacyRole: 'staff',
      displayName: 'Zeta Six',
      isCurrentMember: true,
      confidence: 0.5,
    };
    const identity = { displayName: 'Zeta Six' };
    await materializeCanonicalMembership(id, facts, identity);
    await materializeCanonicalMembership(id, facts, identity);
    await materializeCanonicalMembership(id, facts, identity);
    expect(await Researcher.countDocuments({ displayName: 'Zeta Six' })).toBe(2);
    expect(
      await Researcher.countDocuments({
        displayName: 'Zeta Six',
        accountId: { $exists: false },
      }),
    ).toBe(1);
    expect(await RoleAssignment.countDocuments({})).toBe(1);
  });

  it('archives departing members to HISTORICAL while keeping them visible (archived:false)', async () => {
    const id = entityId();
    await materializeCanonicalMembership(
      id,
      {
        legacyRole: 'grad-student',
        displayName: 'Epsilon Five',
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.7,
      },
      {
        netid: 'ef345',
        email: 'ef345@example.test',
        displayName: 'Epsilon Five',
        hasCanonicalSourceReference: true,
      },
    );
    const personId = await resolveCanonicalResearcherId({
      netid: 'ef345',
      displayName: 'Epsilon Five',
    });
    expect(personId).toBeTruthy();
    const endedAt = new Date('2021-06-01T00:00:00.000Z');
    await archiveCanonicalRoleAssignmentsForPersons(id, [personId!], endedAt);
    const assignment = await RoleAssignment.findOne({ personId }).lean<
      WithObjectId<RoleAssignmentRecord>
    >();
    expect(assignment?.state).toBe('HISTORICAL');
    expect(assignment?.endedAt?.toISOString()).toBe(endedAt.toISOString());
    expect(assignment?.archived).toBe(false);
  });

  it('archives director-superseded roles but keeps lead assignments', async () => {
    const id = entityId();
    const entityObjectId = new mongoose.Types.ObjectId(id);
    const personId = new mongoose.Types.ObjectId();
    const base = {
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
      evidenceClaimIds: [],
      confidence: 0.5,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      state: 'CURRENT',
    } as const;
    await RoleAssignment.create({ ...base, role: 'AFFILIATED' });
    await RoleAssignment.create({ ...base, role: 'CORE_FACULTY' });
    await RoleAssignment.create({ ...base, role: 'DIRECTOR' });
    await archiveSupersededCanonicalRoleAssignments(id, personId);
    expect(await RoleAssignment.countDocuments({ personId, archived: true })).toBe(2);
    const director = await RoleAssignment.findOne({ personId, role: 'DIRECTOR' }).lean<
      WithObjectId<RoleAssignmentRecord>
    >();
    expect(director?.archived).toBe(false);
  });
});
