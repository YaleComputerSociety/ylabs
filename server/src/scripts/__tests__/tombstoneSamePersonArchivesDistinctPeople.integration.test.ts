import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
const SAME_PERSON_SCRIPT = path.resolve(__dirname, '../tombstoneSamePersonArchives.ts');

const oid = () => new mongoose.Types.ObjectId();
const db = () => mongoose.connection.db!;

function runScript(script: string, mongoUrl: string, args: string[]): Promise<any> {
  const outputPath = path.join(os.tmpdir(), `fold-lane-${process.pid}-${oid()}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [script, ...args, `--output=${outputPath}`], {
      cwd: path.resolve(__dirname, '../../..'),
      env: hermeticChildEnvironment({ MONGODBURL: mongoUrl, NODE_ENV: 'test' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`${script} exited ${code}: ${stderr}`));
      const written = fs.existsSync(outputPath)
        ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
        : null;
      if (written) fs.unlinkSync(outputPath);
      const summaryStart = stdout.lastIndexOf('\n{');
      const summary = JSON.parse(summaryStart >= 0 ? stdout.slice(summaryStart) : stdout);
      resolve({ written, summary });
    });
  });
}

const leadEdge = (entityId: unknown, personId: unknown, extra: Record<string, unknown> = {}) => ({
  personId,
  target: { kind: 'RESEARCH_ENTITY', id: entityId },
  role: 'PI',
  state: 'CURRENT',
  confidence: 0.9,
  archived: false,
  ...extra,
});

async function seedPeople(verdict: boolean) {
  const x = oid();
  const y = oid();
  await db()
    .collection('researchers')
    .insertMany([
      {
        _id: x,
        displayName: 'Ada Quill',
        archived: false,
        ...(verdict ? { distinctFromResearcherIds: [y] } : {}),
      },
      { _id: y, displayName: 'Wren Ortolan', archived: false },
    ]);
  return { x, y };
}

describe('the same-person archive tombstone lane honours a recorded distinct-people verdict (#5802)', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('yale_research_dev');
    await mongoose.connect(mongoUrl);
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'observations']) {
      await db().collection(name).deleteMany({});
    }
  });

  async function seedSamePersonArchive(verdict: boolean) {
    const { x, y } = await seedPeople(verdict);
    const live = oid();
    const archived = oid();
    await db()
      .collection('research_entities')
      .insertMany([
        {
          _id: live,
          slug: 'faculty-research-area-ada-quill',
          name: 'Ada Quill Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          archived: false,
        },
        {
          _id: archived,
          slug: 'faculty-research-area-ada-quill-2',
          name: 'Ada Quill Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          archived: true,
        },
      ]);
    await db()
      .collection('role_assignments')
      .insertMany([
        leadEdge(live, x),
        leadEdge(live, y, { role: 'CO_PI' }),
        leadEdge(archived, y, { state: 'HISTORICAL', archived: true }),
      ]);
    const observation = (entityId: unknown, entityKey: string) => ({
      entityType: 'researchEntity',
      entityId,
      entityKey,
      field: 'inferredPiUserKey',
      value: 'aq1',
      sourceName: 'dept-faculty-roster',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });
    await db()
      .collection('observations')
      .insertMany([
        observation(live, 'faculty-research-area-ada-quill'),
        observation(archived, 'faculty-research-area-ada-quill-2'),
      ]);
    return { live, archived };
  }

  it('the same-person archive tombstones do not point one person`s archived row at the other`s', async () => {
    const { archived } = await seedSamePersonArchive(true);
    const { summary } = await runScript(SAME_PERSON_SCRIPT, mongoUrl, [
      '--apply',
      '--confirm-tombstone-same-person-archives',
    ]);
    expect(summary.planned).toBe(0);
    expect(summary.refusedAsDistinctPeople).toBe(1);
    const row = await db().collection('research_entities').findOne({ _id: archived });
    expect(row?.canonicalGroupId ?? null).toBeNull();
  }, 180_000);

  it('the same-person archive tombstones still point the archived row when no verdict is recorded', async () => {
    await seedSamePersonArchive(false);
    const { summary } = await runScript(SAME_PERSON_SCRIPT, mongoUrl, ['--dry-run']);
    expect(summary.planned).toBe(1);
    expect(summary.refusedAsDistinctPeople).toBe(0);
  }, 180_000);
});
