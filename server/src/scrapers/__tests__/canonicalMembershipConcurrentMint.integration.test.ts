import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeCanonicalMembership } from '../canonicalMembershipMaterializer';

const leadFacts = { legacyRole: 'pi', isCurrentMember: true, confidence: 0.9 };

describe('two research rows materialized at once naming the same new lead mint one person (#5521)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Researcher.init(), RoleAssignment.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await Researcher.deleteMany({});
    await RoleAssignment.deleteMany({});
  });

  const mintConcurrently = async (identity: Record<string, unknown>, rows: number) => {
    const entityIds = Array.from({ length: rows }, () => String(new mongoose.Types.ObjectId()));
    const outcomes = await Promise.all(
      entityIds.map((entityId) =>
        materializeCanonicalMembership(
          entityId,
          { ...leadFacts, displayName: String(identity.displayName) },
          identity,
        ),
      ),
    );
    const people = await Researcher.find({ displayName: identity.displayName }).lean();
    const edges = await RoleAssignment.find({}).lean();
    return { outcomes, people, edges, entityIds };
  };

  it('collapses a name-only lead to one researcher', async () => {
    const { people, edges, entityIds } = await mintConcurrently(
      { displayName: 'Example Shared Lead' },
      8,
    );

    expect(people).toHaveLength(1);
    expect(edges).toHaveLength(entityIds.length);
    expect(new Set(edges.map((edge) => String(edge.personId)))).toEqual(
      new Set([String(people[0]._id)]),
    );
  }, 120000);

  it('collapses a lead identified by netid and email to one researcher', async () => {
    const { people, edges, entityIds } = await mintConcurrently(
      {
        displayName: 'Example Netid Lead',
        netid: 'zz999',
        email: 'example.netid.lead@example.yale.edu',
      },
      8,
    );

    expect(people).toHaveLength(1);
    expect(edges).toHaveLength(entityIds.length);
    expect(new Set(edges.map((edge) => String(edge.personId)))).toEqual(
      new Set([String(people[0]._id)]),
    );
  }, 120000);

  it('collapses a noisy and a clean spelling of one new lead to one researcher, as running them in that order would', async () => {
    const spellings = ['Photo of Example Spelled Lead.', 'Example Spelled Lead'];
    await Promise.all(
      spellings.map((displayName) =>
        materializeCanonicalMembership(
          String(new mongoose.Types.ObjectId()),
          { ...leadFacts, displayName },
          { displayName },
        ),
      ),
    );
    const people = await Researcher.find({ displayName: /Example Spelled Lead/ }).lean();
    const edges = await RoleAssignment.find({}).lean();

    expect(people.map((person) => person.displayName)).toEqual(['Example Spelled Lead']);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((edge) => String(edge.personId)))).toEqual(
      new Set([String(people[0]._id)]),
    );
  }, 120000);
});
