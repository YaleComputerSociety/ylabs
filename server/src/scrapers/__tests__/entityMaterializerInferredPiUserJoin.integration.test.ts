import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import {
  materializeInferredPiMembership,
  userEntityKeyForInferredPiUserKey,
} from '../entityMaterializer';

describe('userEntityKeyForInferredPiUserKey', () => {
  it('reads a bare roster alias and a Yale email as the netid user key', () => {
    expect(userEntityKeyForInferredPiUserKey('Tamsin.Quorvale')).toBe('netid:tamsin.quorvale');
    expect(userEntityKeyForInferredPiUserKey('tamsin.quorvale@yale.edu')).toBe(
      'netid:tamsin.quorvale',
    );
    expect(userEntityKeyForInferredPiUserKey('tq417@med.yale.edu')).toBe('netid:tq417');
  });

  it('leaves a namespaced key and a non-Yale address as stored', () => {
    expect(userEntityKeyForInferredPiUserKey('ysm:tamsin-quorvale')).toBe('ysm:tamsin-quorvale');
    expect(userEntityKeyForInferredPiUserKey('netid:tq417')).toBe('netid:tq417');
    expect(userEntityKeyForInferredPiUserKey('tq@example.com')).toBe('tq@example.com');
  });
});

describe('materializeInferredPiMembership follows the user identity join', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['researchers', 'role_assignments', 'research_entities', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  const seedEntity = async (slug: string, name: string) =>
    ResearchEntity.create({
      slug,
      name,
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });

  const seedResearcher = async (displayName: string, title: string) =>
    Researcher.create({
      schemaVersion: 1,
      displayName,
      profile: { title },
      status: 'ACTIVE',
      archived: false,
    });

  const seedUserName = async (entityKey: string, fname: string, lname: string) => {
    for (const [field, value] of [
      ['fname', fname],
      ['lname', lname],
    ]) {
      await Observation.create({
        entityType: 'user',
        entityKey,
        field,
        value,
        sourceName: 'ysm-faculty-directory',
        sourceUrl: 'https://example.edu/profile/synthetic/',
        sourceId: new mongoose.Types.ObjectId(),
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
      });
    }
  };

  const piKey = (value: string) => ({
    field: 'inferredPiUserKey',
    value,
    sourceName: 'ysm-faculty-directory',
    sourceUrl: 'https://example.edu/profile/synthetic/',
    confidence: 0.88,
    observedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const leads = async (entityId: unknown) =>
    RoleAssignment.find({ 'target.id': entityId, role: 'PI' }).lean();

  it('links the researcher a key-only identifier reaches through its observed full name', async () => {
    const entity = await seedEntity('synthetic-join-name', 'Tamsin Quorvale Faculty Research');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Associate Professor of Medicine');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });

  it('links a Yale email key through the netid user key it names', async () => {
    const entity = await seedEntity('synthetic-join-email', 'Tamsin Quorvale Faculty Research');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Professor of Chemistry');
    await seedUserName('netid:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('tq417@yale.edu')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });

  it('refuses a joined researcher whose title cannot own a research home', async () => {
    const entity = await seedEntity('synthetic-join-trainee', 'Tamsin Quorvale Faculty Research');
    await seedResearcher('Tamsin Quorvale', 'Postdoctoral Associate');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    expect(await leads(entity._id)).toHaveLength(0);
  });

  it('refuses a joined researcher who is not the person an eponymous lab name names', async () => {
    const entity = await seedEntity('synthetic-join-eponym', 'Brindlecomb Lab');
    await seedResearcher('Odile Brindlecomb', 'Professor of Genetics');
    await seedResearcher('Tamsin Quorvale', 'Associate Research Scientist');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    expect(await leads(entity._id)).toHaveLength(0);
  });

  it('does not read a topical lab name as another person when no researcher holds the word', async () => {
    const entity = await seedEntity('synthetic-join-topical', 'Glycomics Lab');
    const researcher = await seedResearcher('Tamsin Quorvale', 'Associate Professor of Medicine');
    await seedUserName('ysm:tq417', 'Tamsin', 'Quorvale');

    await materializeInferredPiMembership(String(entity._id), [piKey('ysm:tq417')]);

    const found = await leads(entity._id);
    expect(found).toHaveLength(1);
    expect(String(found[0].personId)).toBe(String(researcher._id));
  });
});
