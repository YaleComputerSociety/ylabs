import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleAssignment } from '../../models/roleAssignment';
import { activeLeadPersonIds } from '../grantShellRelinkBackfill';
import { classifyDisposition } from '../grantShellRelinkCore';

const oid = () => new mongoose.Types.ObjectId();

const seedLead = async (params: {
  personId: mongoose.Types.ObjectId;
  entityId: mongoose.Types.ObjectId;
  state: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';
}) => {
  await RoleAssignment.create({
    schemaVersion: 1,
    personId: params.personId,
    target: { kind: 'RESEARCH_ENTITY', id: params.entityId },
    role: 'PI',
    state: params.state,
    evidenceClaimIds: [],
    confidence: 0.5,
    reviewStatus: 'UNREVIEWED',
    archived: false,
  });
};

describe('grant-shell relink idempotency at the RoleAssignment layer (#822)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 60000 }],
    });
    await mongoose.connect(replSet.getUri());
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await RoleAssignment.deleteMany({});
  });

  it('classifies a shell as personid-divergent when a divergent person holds the active lead and the canonical PI is only HISTORICAL', async () => {
    const shellEntityId = oid();
    const canonicalPersonId = oid();
    const divergentPersonId = oid();

    await seedLead({ personId: canonicalPersonId, entityId: shellEntityId, state: 'HISTORICAL' });
    await seedLead({ personId: divergentPersonId, entityId: shellEntityId, state: 'UNKNOWN' });

    const activeLeads = await activeLeadPersonIds(shellEntityId);

    expect(activeLeads).toEqual([divergentPersonId.toHexString()]);
    expect(activeLeads).not.toContain(canonicalPersonId.toHexString());

    const disposition = classifyDisposition({
      matched: 'matched-user',
      canonicalPersonId: canonicalPersonId.toHexString(),
      activeLeadPersonIds: activeLeads,
    });

    expect(disposition).toBe('personid-divergent');
  });

  it('does not re-propose a personid-divergent shell across repeated dry runs (idempotent)', async () => {
    const shellEntityId = oid();
    const canonicalPersonId = oid();
    const divergentPersonId = oid();

    await seedLead({ personId: canonicalPersonId, entityId: shellEntityId, state: 'HISTORICAL' });
    await seedLead({ personId: divergentPersonId, entityId: shellEntityId, state: 'UNKNOWN' });

    const classifyOnce = async () =>
      classifyDisposition({
        matched: 'matched-user',
        canonicalPersonId: canonicalPersonId.toHexString(),
        activeLeadPersonIds: await activeLeadPersonIds(shellEntityId),
      });

    expect(await classifyOnce()).toBe('personid-divergent');
    expect(await classifyOnce()).toBe('personid-divergent');
  });

  it('classifies newly-linked only when no active lead exists at all', async () => {
    const shellEntityId = oid();
    const canonicalPersonId = oid();

    await seedLead({ personId: canonicalPersonId, entityId: shellEntityId, state: 'HISTORICAL' });

    const disposition = classifyDisposition({
      matched: 'matched-user',
      canonicalPersonId: canonicalPersonId.toHexString(),
      activeLeadPersonIds: await activeLeadPersonIds(shellEntityId),
    });

    expect(disposition).toBe('newly-linked');
  });

  it('classifies already-linked once the canonical PI holds a non-historical lead', async () => {
    const shellEntityId = oid();
    const canonicalPersonId = oid();

    await seedLead({ personId: canonicalPersonId, entityId: shellEntityId, state: 'CURRENT' });

    const disposition = classifyDisposition({
      matched: 'matched-user',
      canonicalPersonId: canonicalPersonId.toHexString(),
      activeLeadPersonIds: await activeLeadPersonIds(shellEntityId),
    });

    expect(disposition).toBe('already-linked');
  });
});
