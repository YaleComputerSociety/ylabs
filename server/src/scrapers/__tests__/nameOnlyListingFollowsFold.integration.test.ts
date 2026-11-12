import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { writeCanonicalMembership } from '../canonicalMembershipMaterializer';

const listedName = 'Avery Synth';
const memberFacts = {
  legacyRole: 'core-faculty',
  isCurrentMember: true,
  confidence: 0.8,
  displayName: listedName,
};

describe('a name-only listing reaches the survivor of a folded record (#6019)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    await Researcher.deleteMany({});
    await RoleAssignment.deleteMany({});
  });

  const survivorRecord = (displayName = 'Avery J. Synth', archived = false) =>
    Researcher.create({
      displayName,
      identifiers: { email: 'directory.fixture1@example.test' },
      profileLinks: [],
      archived,
    });

  const foldedInto = (survivorId: mongoose.Types.ObjectId) =>
    Researcher.create({
      displayName: listedName,
      profileLinks: [],
      archived: true,
      dedupedIntoResearcherId: survivorId,
      dedupedAt: new Date('2026-11-12T00:00:00Z'),
    });

  const listOnce = () =>
    writeCanonicalMembership(String(new mongoose.Types.ObjectId()), memberFacts, {
      displayName: listedName,
    });

  it('writes the membership for the survivor instead of minting a new record', async () => {
    const survivor = await survivorRecord();
    await foldedInto(survivor._id);
    const { outcome, personId } = await listOnce();
    expect(outcome).toBe('created');
    expect(String(personId)).toBe(String(survivor._id));
    expect(await Researcher.countDocuments({ archived: { $ne: true } })).toBe(1);
  });

  it('resolves a namesake who was never folded as before', async () => {
    const { personId } = await listOnce();
    const minted = await Researcher.findById(personId).lean();
    expect(minted?.displayName).toBe(listedName);
    expect(minted?.archived).toBe(false);
  });

  it('never resolves to an archived survivor', async () => {
    const archivedSurvivor = await survivorRecord('Avery J. Synth', true);
    await foldedInto(archivedSurvivor._id);
    const { personId } = await listOnce();
    expect(String(personId)).not.toBe(String(archivedSurvivor._id));
    const minted = await Researcher.findById(personId).lean();
    expect(minted?.archived).toBe(false);
    expect(minted?.dedupedIntoResearcherId).toBeUndefined();
  });

  it('resolves to none of them when folded namesakes point at different survivors', async () => {
    const first = await survivorRecord();
    const second = await Researcher.create({
      displayName: 'Avery K. Synth',
      identifiers: { email: 'directory.fixture2@example.test' },
      profileLinks: [],
      archived: false,
    });
    await foldedInto(first._id);
    await foldedInto(second._id);
    const { personId } = await listOnce();
    expect([String(first._id), String(second._id)]).not.toContain(String(personId));
  });

  it('keeps a live name-only record of that name ahead of the fold', async () => {
    const survivor = await survivorRecord();
    await foldedInto(survivor._id);
    const live = await Researcher.create({
      displayName: listedName,
      profileLinks: [],
      archived: false,
    });
    const { personId } = await listOnce();
    expect(String(personId)).toBe(String(live._id));
  });
});
