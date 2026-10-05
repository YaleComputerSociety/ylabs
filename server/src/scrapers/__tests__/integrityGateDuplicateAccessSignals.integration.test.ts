import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPostMaterializationIntegrityGate } from '../integrityGate';

describe('duplicateAccessSignals counts one evidence-id duplicate once (#4795)', () => {
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
    await mongoose.connection.db!.collection('signals').deleteMany({});
  });

  const seedSignalsSharingEvidence = async (sharedDerivationKey: boolean) => {
    const entityId = new mongoose.Types.ObjectId();
    const evidenceId = new mongoose.Types.ObjectId();
    const signal = (index: number) => ({
      type: 'POSTED_OPENING',
      researchEntityId: entityId,
      derivationKey: sharedDerivationKey ? 'synthetic-derivation' : `synthetic-derivation-${index}`,
      source: { evidenceIds: [evidenceId] },
      archived: false,
    });
    await mongoose.connection.db!.collection('signals').insertMany([signal(1), signal(2)]);
  };

  it('reports one group for two signals that cite the same evidence', async () => {
    await seedSignalsSharingEvidence(false);

    const summary = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 25 });

    expect(summary.counts.duplicateAccessSignals).toBe(1);
    expect(summary.samples.duplicateAccessSignals).toEqual([
      expect.objectContaining({ identityField: 'sourceEvidenceId' }),
    ]);
  });

  it('reports one group per distinct identity when two identities repeat', async () => {
    await seedSignalsSharingEvidence(true);

    const summary = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 25 });

    expect(summary.counts.duplicateAccessSignals).toBe(2);
    expect(
      (summary.samples.duplicateAccessSignals as Array<{ identityField: string }>)
        .map((group) => group.identityField)
        .sort(),
    ).toEqual(['derivationKey', 'sourceEvidenceId']);
  });
});
