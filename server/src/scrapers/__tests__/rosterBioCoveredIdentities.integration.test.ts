import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { loadRosterBioCoveredIdentities } from '../sources/rosterBioResearchEvidenceScraper';

const row = (slug: string, entityType: string, archived = false) =>
  ResearchEntity.create({
    slug,
    name: `${slug} row`,
    kind: entityType === 'LAB' ? 'lab' : entityType === 'CENTER' ? 'center' : 'individual',
    entityType,
    archived,
  });

const person = async (displayName: string, profileUrl: string) => {
  const inserted = await mongoose.connection
    .collection('researchers')
    .insertOne({ displayName, profileLinks: [{ url: profileUrl }], archived: false });
  return { _id: inserted.insertedId };
};

const edge = (personId: unknown, targetId: unknown, role: string, state = 'CURRENT') =>
  RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: targetId },
    role,
    state,
    confidence: 0.9,
  });

describe(
  'roster-biography coverage lists only research a person leads (#5407)',
  { timeout: 120000 },
  () => {
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
      const db = mongoose.connection.db!;
      for (const name of ['research_entities', 'researchers', 'role_assignments', 'observations']) {
        await db.collection(name).deleteMany({});
      }
    });

    it('does not treat a center or institute membership as the person being listed', async () => {
      const center = await row('synthetic-center', 'CENTER');
      const member = await person('Robin Fixture', 'https://example.yale.edu/people/robin-fixture');
      await edge(member._id, center._id, 'CORE_FACULTY');
      const covered = await loadRosterBioCoveredIdentities();
      expect(covered.personNames.has('robin fixture')).toBe(false);
      expect(covered.urls.has('example.yale.edu/people/robin-fixture')).toBe(false);
    });

    it('treats a lead of a lab or faculty research row as listed', async () => {
      const lab = await row('synthetic-lab', 'LAB');
      const lead = await person('Casey Fixture', 'https://example.yale.edu/people/casey-fixture');
      await edge(lead._id, lab._id, 'PI');
      const covered = await loadRosterBioCoveredIdentities();
      expect(covered.personNames.has('casey fixture')).toBe(true);
      expect(covered.urls.has('example.yale.edu/people/casey-fixture')).toBe(true);
    });

    it('treats an ended lead of an archived personal row as a past decision about the person', async () => {
      const archived = await row('synthetic-archived-area', 'FACULTY_RESEARCH_AREA', true);
      const former = await person(
        'Jordan Fixture',
        'https://example.yale.edu/people/jordan-fixture',
      );
      await edge(former._id, archived._id, 'PI', 'HISTORICAL');
      const covered = await loadRosterBioCoveredIdentities();
      expect(covered.personNames.has('jordan fixture')).toBe(true);
    });

    it('treats an archived personal row in the name as covered even without a researcher record', async () => {
      await ResearchEntity.create({
        slug: 'synthetic-grant-area',
        name: 'Morgan Fixture Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: true,
      });
      const covered = await loadRosterBioCoveredIdentities();
      expect(covered.personNames.has('morgan fixture')).toBe(true);
    });

    it('does not treat a member of someone else lab as leading it', async () => {
      const lab = await row('synthetic-host-lab', 'LAB');
      const member = await person('Avery Fixture', 'https://example.yale.edu/people/avery-fixture');
      await edge(member._id, lab._id, 'CORE_FACULTY');
      const covered = await loadRosterBioCoveredIdentities();
      expect(covered.personNames.has('avery fixture')).toBe(false);
    });
  },
);
