import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { researchEntityIdsLinkedToResearchers } from '../researcherLinkedSearchResync';

let memoryServer: MongoMemoryServer | undefined;

describe('researchEntityIdsLinkedToResearchers (#6374)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('researcher_linked_rows_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('returns the research rows with a live edge to the person, as strings', async () => {
    const person = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const led = new mongoose.Types.ObjectId();
    const former = new mongoose.Types.ObjectId();
    const archivedEdge = new mongoose.Types.ObjectId();
    const someoneElses = new mongoose.Types.ObjectId();
    const edge = (personId: mongoose.Types.ObjectId, id: mongoose.Types.ObjectId, extra = {}) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      ...extra,
    });
    await mongoose.connection
      .db!.collection('role_assignments')
      .insertMany([
        edge(person, led),
        edge(person, former, { state: 'HISTORICAL' }),
        edge(person, archivedEdge, { archived: true }),
        edge(other, someoneElses),
      ]);

    expect(await researchEntityIdsLinkedToResearchers([String(person), String(person)])).toEqual([
      String(led),
    ]);
    expect(await researchEntityIdsLinkedToResearchers(['not-an-object-id'])).toEqual([]);
  });
});
