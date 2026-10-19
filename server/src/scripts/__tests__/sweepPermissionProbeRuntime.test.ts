import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import type { PermissionProbeCheck, PermissionProbePlan } from '../opsSweepCore';

const runtime = createRequire(import.meta.url)('../sweepPermissionProbeRuntime.cjs') as {
  classifyProbeError: (error: unknown) => { outcome: string };
  runPermissionProbe: (
    client: unknown,
    objectId: unknown,
    plan: PermissionProbePlan,
  ) => Promise<{ exitCode: number; unexpected: unknown[]; results: Array<{ ok: boolean }> }>;
};

class FakeObjectId {
  readonly id = Math.random();
}

const denied = () =>
  Object.assign(new Error('user is not allowed to do action [update] on [Beta.x]'), { code: 8000 });

interface Recorded {
  writes: string[];
  aborted: number;
  committed: number;
}

function fakeClient(options: { user: string; deny: (db: string, op: string) => boolean }) {
  const recorded: Recorded = { writes: [], aborted: 0, committed: 0 };
  const guard = async (db: string, op: string) => {
    if (options.deny(db, op)) throw denied();
  };
  const collection = (db: string, name: string) => ({
    findOne: () => guard(db, 'find'),
    insertOne: async (_doc: unknown, opts: { session?: unknown }) => {
      await guard(db, 'insert');
      if (!opts?.session) recorded.writes.push(`insert ${db}.${name}`);
    },
    updateOne: async (filter: { _id: unknown }) => {
      await guard(db, `update ${name}`);
      if (!(filter._id instanceof FakeObjectId)) recorded.writes.push(`update ${db}.${name}`);
    },
    deleteOne: async (filter: { _id: unknown }) => {
      await guard(db, 'remove');
      if (!(filter._id instanceof FakeObjectId)) recorded.writes.push(`remove ${db}.${name}`);
    },
    indexes: () => guard(db, 'listIndexes'),
    createIndex: async (_spec: unknown, opts: { session?: unknown }) => {
      await guard(db, 'createIndex');
      if (!opts?.session) recorded.writes.push(`createIndex ${db}.${name}`);
    },
    drop: async () => {
      await guard(db, 'drop');
      throw Object.assign(new Error('ns not found'), { code: 26 });
    },
  });
  const client = {
    db: (db: string) => ({
      collection: (name: string) => collection(db, name),
      listCollections: () => ({ toArray: () => guard(db, 'listCollections') }),
      command: async (command: Record<string, unknown>) => {
        if (command.connectionStatus) {
          return { authInfo: { authenticatedUsers: [{ user: options.user, db: 'admin' }] } };
        }
        await guard(db, Object.keys(command)[0]);
        return {};
      },
    }),
    startSession: () => ({
      startTransaction: () => undefined,
      abortTransaction: async () => {
        recorded.aborted += 1;
      },
      commitTransaction: async () => {
        recorded.committed += 1;
      },
      endSession: async () => undefined,
    }),
  };
  return { client, recorded };
}

const checks: PermissionProbeCheck[] = [
  { db: 'Development', collection: 'scrape_runs', action: 'find', expect: 'allowed' },
  { db: 'Development', collection: 'scrape_runs', action: 'insert', expect: 'allowed' },
  { db: 'Development', collection: 'scrape_runs', action: 'update', expect: 'allowed' },
  { db: 'Development', collection: 'scrape_runs', action: 'remove', expect: 'allowed' },
  { db: 'Development', action: 'dbStats', expect: 'allowed' },
  { db: 'admin', action: 'listDatabases', expect: 'allowed' },
  { db: 'Development', collection: 'accounts', action: 'update', expect: 'denied' },
  { db: 'Development', collection: 'probe', action: 'createIndex', expect: 'denied' },
  { db: 'Development', collection: 'probe', action: 'drop', expect: 'denied' },
  { db: 'Beta', collection: 'research_entities', action: 'find', expect: 'denied' },
  { db: 'Beta', collection: 'research_entities', action: 'update', expect: 'denied' },
];
const plan: PermissionProbePlan = { expectedUser: 'ylabs-sweep-dev', checks, unprobedActions: [] };

const sweepRoleDenies = (db: string, op: string) =>
  db === 'Beta' || op === 'update accounts' || op === 'createIndex' || op === 'drop';

describe('permission probe runtime', () => {
  it('passes when every grant is allowed and every expected denial is denied, writing nothing', async () => {
    const { client, recorded } = fakeClient({ user: 'ylabs-sweep-dev', deny: sweepRoleDenies });
    const report = await runtime.runPermissionProbe(client, FakeObjectId, plan);
    expect(report.exitCode).toBe(0);
    expect(report.results.every((result) => result.ok)).toBe(true);
    expect(recorded.writes).toEqual([]);
    expect(recorded.committed).toBe(0);
    expect(recorded.aborted).toBe(2);
  });

  it('exits 3 when a denial is unexpectedly allowed or a grant is denied', async () => {
    const { client } = fakeClient({
      user: 'ylabs-sweep-dev',
      deny: (db, op) => (db === 'Beta' && op === 'find') || op === 'insert',
    });
    const report = await runtime.runPermissionProbe(client, FakeObjectId, plan);
    expect(report.exitCode).toBe(3);
    expect(report.unexpected.length).toBe(5);
  });

  it('exits 4 without probing when the authenticated user is not the sweep user', async () => {
    const { client } = fakeClient({ user: 'ycsmaintenance', deny: () => false });
    const report = await runtime.runPermissionProbe(client, FakeObjectId, plan);
    expect(report.exitCode).toBe(4);
    expect(report.results).toEqual([]);
  });

  it('classifies Atlas and server denials, and a missing namespace as authorized', () => {
    expect(runtime.classifyProbeError(denied()).outcome).toBe('denied');
    expect(runtime.classifyProbeError(new Error('not authorized on Beta to execute')).outcome).toBe(
      'denied',
    );
    expect(runtime.classifyProbeError({ code: 13, message: 'x' }).outcome).toBe('denied');
    expect(runtime.classifyProbeError({ code: 26, message: 'ns not found' }).outcome).toBe(
      'allowed',
    );
    expect(runtime.classifyProbeError(new Error('connection reset')).outcome).toBe('error');
  });
});
