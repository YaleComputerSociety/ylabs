import net from 'net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { scriptMongoConnectOptions } from '../../db/connections';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeFromRun } from '../entityMaterializer';

const USERS = 120;
const POOL_SIZE = 10;
const FLAP_AFTER_COMMANDS = 400;
const OUTAGE_MS = 2_000;
const SETTLE_BOUND_MS = 25_000;
const SCOPE = ['identifiers.email', 'identifiers.emailSupport'];

class FlappingProxy {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private refusing = false;
  port = 0;

  constructor(targetPort: number) {
    this.server = net.createServer((client) => {
      if (this.refusing) {
        client.resetAndDestroy();
        return;
      }
      const upstream = net.connect(targetPort, '127.0.0.1');
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => undefined);
      }
      client.pipe(upstream).pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  dropEveryConnectionFor(ms: number): void {
    this.refusing = true;
    for (const socket of this.sockets) socket.resetAndDestroy();
    setTimeout(() => {
      this.refusing = false;
    }, ms);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

interface PoolTally {
  checkedOut: number;
  waiting: number;
  maxCheckedOut: number;
  cleared: number;
  readyAfterClear: number;
  commands: number;
}

const settlesWithin = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the materialize did not settle within ${ms} ms`)),
        ms,
      );
      timer.unref();
    }),
  ]);

describe('a field-scoped user materialize on a 10-connection script pool (#5945)', () => {
  let replSet: MongoMemoryReplSet;
  let proxy: FlappingProxy;
  const scrapeRunId = new mongoose.Types.ObjectId();
  const tally: PoolTally = {
    checkedOut: 0,
    waiting: 0,
    maxCheckedOut: 0,
    cleared: 0,
    readyAfterClear: 0,
    commands: 0,
  };
  let onCommand: (count: number) => void = () => undefined;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    proxy = new FlappingProxy(Number(replSet.servers[0].instanceInfo!.port));
    await proxy.listen();
    await mongoose.connect(`mongodb://127.0.0.1:${proxy.port}/flap?directConnection=true`, {
      ...scriptMongoConnectOptions({ maxPoolSize: POOL_SIZE }),
      heartbeatFrequencyMS: 500,
      monitorCommands: true,
    } as mongoose.ConnectOptions);
    const client = mongoose.connection.getClient();
    client.on('connectionCheckOutStarted', () => {
      tally.waiting += 1;
    });
    client.on('connectionCheckOutFailed', () => {
      tally.waiting -= 1;
    });
    client.on('connectionCheckedOut', () => {
      tally.waiting -= 1;
      tally.checkedOut += 1;
      tally.maxCheckedOut = Math.max(tally.maxCheckedOut, tally.checkedOut);
    });
    client.on('connectionCheckedIn', () => {
      tally.checkedOut -= 1;
    });
    client.on('connectionPoolCleared', () => {
      tally.cleared += 1;
    });
    client.on('connectionPoolReady', () => {
      if (tally.cleared > 0) tally.readyAfterClear += 1;
    });
    client.on('commandStarted', () => {
      tally.commands += 1;
      onCommand(tally.commands);
    });

    await Observation.syncIndexes();
    const researchers = [];
    const observations = [];
    for (let index = 0; index < USERS; index += 1) {
      const netid = `zq${String(index).padStart(4, '0')}f`;
      researchers.push({
        displayName: `Flap Fixture ${index}`,
        identifiers: { netid },
        profile: {},
        profileLinks: [],
        status: 'UNKNOWN',
        archived: false,
      });
      for (const [field, value] of [
        ['fname', 'Flap'],
        ['lname', `Fixture${index}`],
        ['email', `flap.fixture${index}@example.edu`],
        ['title', 'Professor of Fixture Studies'],
      ]) {
        observations.push({
          entityType: 'user',
          entityKey: `netid:${netid}`,
          field,
          value,
          sourceId: new mongoose.Types.ObjectId(),
          sourceName: 'dept-faculty-roster',
          sourceUrl: `https://flap-fixture.example.edu/people/${index}`,
          confidence: 0.9,
          observedAt: new Date('2026-11-01T00:00:00Z'),
          superseded: false,
          scrapeRunId,
        });
      }
    }
    await Researcher.insertMany(researchers);
    await Observation.insertMany(observations);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await proxy?.close();
    await replSet?.stop();
  });

  const materialize = () =>
    settlesWithin(
      materializeFromRun(String(scrapeRunId), { dryRun: true, userWriteOnlyFields: SCOPE }),
      SETTLE_BOUND_MS,
    );

  it('finishes every key without ever needing the whole pool', async () => {
    const result = await materialize();

    expect(result.userFieldScope?.keys).toBe(USERS);
    expect(result.errors).toBe(0);
    expect(tally.maxCheckedOut).toBeLessThan(POOL_SIZE);
    expect(tally.checkedOut).toBe(0);
  });

  it('recovers from every connection dropping mid-run instead of waiting forever', async () => {
    const commandsBefore = tally.commands;
    onCommand = (count) => {
      if (count !== commandsBefore + FLAP_AFTER_COMMANDS) return;
      proxy.dropEveryConnectionFor(OUTAGE_MS);
    };

    const result = await materialize();

    expect(tally.cleared).toBeGreaterThan(0);
    expect(tally.readyAfterClear).toBeGreaterThan(0);
    expect(result.userFieldScope?.keys).toBe(USERS);
    expect(result.materialized + result.errors).toBe(USERS);
    expect(tally.checkedOut).toBe(0);
    expect(tally.waiting).toBe(0);
  });
});
