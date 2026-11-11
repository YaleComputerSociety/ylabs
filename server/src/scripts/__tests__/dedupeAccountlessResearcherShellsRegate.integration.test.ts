import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const gateCalls = vi.hoisted(() => [] as Array<{ recordIds?: string[] }>);

vi.mock('../../services/studentVisibilityGateService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runStudentVisibilityGate: vi.fn(async (options: { recordIds?: string[] }) => {
      gateCalls.push({ recordIds: options.recordIds });
      return {};
    }),
  };
});

import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const survivorId = new mongoose.Types.ObjectId();
const shellId = new mongoose.Types.ObjectId();
const bystanderId = new mongoose.Types.ObjectId();

const shellLedRow = new mongoose.Types.ObjectId();
const survivorLedRow = new mongoose.Types.ObjectId();
const survivorArchivedEdgeRow = new mongoose.Types.ObjectId();
const bystanderRow = new mongoose.Types.ObjectId();

describe('dedupeAccountlessResearcherShells re-gates every row the survivor leads (#5687)', () => {
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
    gateCalls.length = 0;
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});

    await db.collection('researchers').insertMany([
      {
        _id: survivorId,
        displayName: 'Ada Fixture',
        archived: false,
        identifiers: { email: 'directory.regate1@example.test' },
      },
      { _id: shellId, displayName: 'Ada Fixture', archived: false },
      {
        _id: bystanderId,
        displayName: 'Bea Bystander',
        archived: false,
        identifiers: { email: 'directory.regate2@example.test' },
      },
    ]);

    await db.collection('role_assignments').insertMany([
      {
        personId: shellId,
        target: { kind: 'RESEARCH_ENTITY', id: shellLedRow },
        role: 'PI',
        archived: false,
      },
      {
        personId: survivorId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorLedRow },
        role: 'PI',
        archived: false,
      },
      {
        personId: survivorId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorArchivedEdgeRow },
        role: 'PI',
        archived: true,
      },
      {
        personId: bystanderId,
        target: { kind: 'RESEARCH_ENTITY', id: bystanderRow },
        role: 'PI',
        archived: false,
      },
    ]);
  });

  it('re-gates the survivor row the fold never touched along with the shell row', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.shellsMerged).toBe(1);
    expect(gateCalls).toHaveLength(1);
    expect(new Set(gateCalls[0].recordIds)).toEqual(
      new Set([String(shellLedRow), String(survivorLedRow)]),
    );
    expect(result.regatedEntities).toBe(2);
  });

  it('re-gates nothing on a second run, because there is no fold left to make', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });
    gateCalls.length = 0;

    const second = await dedupeAccountlessResearcherShells({ apply: true });

    expect(second.shellsMerged).toBe(0);
    expect(second.regatedEntities).toBe(0);
    expect(gateCalls).toHaveLength(0);
  });

  it('re-gates nothing on a dry run', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.regatedEntities).toBe(0);
    expect(gateCalls).toHaveLength(0);
  });
});
