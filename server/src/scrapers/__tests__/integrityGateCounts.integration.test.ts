import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPostMaterializationIntegrityGate } from '../integrityGate';

const GROUPS_PER_CHECK = 3;

describe('runPostMaterializationIntegrityGate counts every group independently of samples (#4790)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'signals',
      'accounts',
      'researchers',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await seedDuplicateGroups();
  });

  const seedDuplicateGroups = async () => {
    const db = mongoose.connection.db!;
    for (let index = 0; index < GROUPS_PER_CHECK; index += 1) {
      const labUrl = `https://medicine.yale.edu/lab/synthetic-lab-${index}/`;
      const first = new mongoose.Types.ObjectId();
      const second = new mongoose.Types.ObjectId();
      await db.collection('research_entities').insertMany([
        { _id: first, slug: `synthetic-a-${index}`, archived: false, websiteUrl: labUrl },
        { _id: second, slug: `synthetic-b-${index}`, archived: false, sourceUrls: [labUrl] },
      ]);

      const personId = new mongoose.Types.ObjectId();
      const edge = () => ({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: first },
        role: 'MEMBER',
        state: 'UNKNOWN',
        archived: false,
      });
      await db.collection('role_assignments').insertMany([edge(), edge()]);

      const signal = () => ({
        type: 'POSTED_OPENING',
        researchEntityId: first,
        derivationKey: `synthetic-derivation-${index}`,
        archived: false,
      });
      await db.collection('signals').insertMany([signal(), signal()]);

      const account = () => ({ email: `synthetic-${index}@example.test`, archived: false });
      await db.collection('accounts').insertMany([account(), account()]);

      await seedSamePiProfileShellPair(index);
    }
  };

  const seedSamePiProfileShellPair = async (index: number) => {
    const db = mongoose.connection.db!;
    const lead = new mongoose.Types.ObjectId();
    const lastName = `Fixturelead${'x'.repeat(index + 1)}`;
    const concreteLab = new mongoose.Types.ObjectId();
    const profileShell = new mongoose.Types.ObjectId();
    const labUrl = `https://medicine.yale.edu/lab/fixture-home-${index}/`;
    await db.collection('researchers').insertOne({
      _id: lead,
      displayName: `Synthetic ${lastName}`,
      archived: false,
    });
    await db.collection('research_entities').insertMany([
      {
        _id: concreteLab,
        slug: `ysm-fixture-home-${index}`,
        name: `${lastName} Laboratory`,
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: labUrl,
        sourceUrls: [labUrl],
        departments: ['Synthetic Medicine'],
        archived: false,
      },
      {
        _id: profileShell,
        slug: `faculty-research-area-fixture-lead-${index}`,
        name: `Synthetic ${lastName} Research`,
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: [`https://medicine.yale.edu/profile/fixture-lead-${index}/`],
        departments: ['Synthetic Medicine'],
        archived: false,
      },
    ]);
    const piEdge = (target: mongoose.Types.ObjectId) => ({
      personId: lead,
      target: { kind: 'RESEARCH_ENTITY', id: target },
      role: 'PI',
      state: 'UNKNOWN',
      archived: false,
    });
    await db.collection('role_assignments').insertMany([piEdge(concreteLab), piEdge(profileShell)]);
  };

  const groupChecks = [
    'samePiSameNameResearchEntities',
    'officialLabUrlResearchEntities',
    'duplicateCurrentMembers',
    'duplicateAccessSignals',
    'duplicatePeople',
  ] as const;

  it('reads N for every group check without --include-samples', async () => {
    const summary = await runPostMaterializationIntegrityGate({});

    for (const name of groupChecks) {
      expect(summary.counts[name], name).toBe(GROUPS_PER_CHECK);
      expect(summary.countLabels[name], name).toBe(String(GROUPS_PER_CHECK));
      expect(summary.samples[name], name).toEqual([]);
    }
    expect(summary.failureNames).toEqual(expect.arrayContaining([...groupChecks]));
  });

  it('agrees with a samples run and marks a sample shorter than the count', async () => {
    const countsOnly = await runPostMaterializationIntegrityGate({});
    const sampled = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 2 });

    expect(sampled.counts).toEqual(countsOnly.counts);
    for (const name of groupChecks) {
      expect(sampled.samples[name], name).toHaveLength(2);
      expect(sampled.countLabels[name], name).toBe(`${GROUPS_PER_CHECK} (sample of 2)`);
    }
  });

  it('keeps an unmarked label when the sample holds every group', async () => {
    const summary = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 25 });

    for (const name of groupChecks) {
      expect(summary.samples[name], name).toHaveLength(GROUPS_PER_CHECK);
      expect(summary.countLabels[name], name).toBe(String(GROUPS_PER_CHECK));
    }
  });
});
