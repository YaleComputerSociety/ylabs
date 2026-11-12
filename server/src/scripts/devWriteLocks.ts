import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  DEV_APPLY_LEASE_NAME,
  DEV_HOST_LEASE_PREFIX,
  DEV_WRITE_LEASE_ENVIRONMENT,
  DEV_WRITE_LEASE_STALLED_MS,
  devWriteLeaseCollection,
  resolveDevWriteLeaseTarget,
  type DevWriteLeaseRecord,
} from '../db/devWriteLease';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(__filename), '../../.env'), quiet: true });

export type DevLockState = 'live' | 'stale' | 'released';
export type DevLockKind = 'apply' | 'host' | 'source';

export interface DevLockRow {
  name: string;
  kind: DevLockKind;
  state: DevLockState;
  ownerId?: string;
  ownerLabel?: string;
  command?: string;
  acquiredAt?: string;
  heartbeatAgeSeconds?: number;
  progressAt?: string;
  progressCount?: number;
  minutesWithoutProgress?: number;
  stalled?: boolean;
}

export function devLockKind(name: string): DevLockKind {
  if (name === DEV_APPLY_LEASE_NAME) return 'apply';
  if (name.startsWith(DEV_HOST_LEASE_PREFIX)) return 'host';
  return 'source';
}

export function devLockState(record: DevWriteLeaseRecord, now: Date): DevLockState {
  if (!record.locked) return 'released';
  const expires = record.leaseExpiresAt ? new Date(record.leaseExpiresAt).getTime() : 0;
  return expires > now.getTime() ? 'live' : 'stale';
}

/**
 * The latest progress any live lease of an owner recorded. A parent and the children that joined
 * its lease share one owner id, and a child that holds only host leases records its progress there,
 * so judging the apply lease alone would flag it while its children work. Host and source leases
 * are each held by one process, so they are judged by their own progress: borrowing a sibling's
 * would hide a hung child behind a busy one.
 */
function latestProgressByOwner(records: DevWriteLeaseRecord[], now: Date): Map<string, number> {
  const latest = new Map<string, number>();
  for (const record of records) {
    if (!record.ownerId || !record.progressAt || devLockState(record, now) !== 'live') continue;
    const at = new Date(record.progressAt).getTime();
    latest.set(record.ownerId, Math.max(at, latest.get(record.ownerId) ?? at));
  }
  return latest;
}

function progressFields(
  record: DevWriteLeaseRecord,
  now: Date,
  ownerProgress: Map<string, number>,
): Pick<DevLockRow, 'progressAt' | 'progressCount' | 'minutesWithoutProgress' | 'stalled'> {
  const latest =
    devLockKind(record.sourceName) === 'apply' && record.ownerId
      ? ownerProgress.get(record.ownerId)
      : record.progressAt
        ? new Date(record.progressAt).getTime()
        : undefined;
  const recorded = {
    ...(record.progressAt ? { progressAt: new Date(record.progressAt).toISOString() } : {}),
    ...(typeof record.progressCount === 'number' ? { progressCount: record.progressCount } : {}),
  };
  if (latest === undefined || devLockState(record, now) !== 'live') return recorded;
  const withoutProgressMs = Math.max(0, now.getTime() - latest);
  return {
    ...recorded,
    minutesWithoutProgress: Math.floor(withoutProgressMs / 60_000),
    stalled: withoutProgressMs >= DEV_WRITE_LEASE_STALLED_MS,
  };
}

export function describeDevLocks(records: DevWriteLeaseRecord[], now: Date): DevLockRow[] {
  const order: Record<DevLockKind, number> = { apply: 0, host: 1, source: 2 };
  const ownerProgress = latestProgressByOwner(records, now);
  return records
    .map((record) => ({
      name: record.sourceName,
      kind: devLockKind(record.sourceName),
      state: devLockState(record, now),
      ...(record.ownerId ? { ownerId: record.ownerId } : {}),
      ...(record.ownerLabel ? { ownerLabel: record.ownerLabel } : {}),
      ...(record.command ? { command: record.command } : {}),
      ...(record.acquiredAt ? { acquiredAt: new Date(record.acquiredAt).toISOString() } : {}),
      ...(record.heartbeatAt
        ? {
            heartbeatAgeSeconds: Math.round(
              (now.getTime() - new Date(record.heartbeatAt).getTime()) / 1000,
            ),
          }
        : {}),
      ...progressFields(record, now, ownerProgress),
    }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

export interface DevLocksArgs {
  json: boolean;
}

export function parseDevLocksArgs(argv: string[]): DevLocksArgs {
  const args: DevLocksArgs = { json: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--json') args.json = true;
    else throw new Error(`Unknown dev:locks argument: ${arg}`);
  }
  return args;
}

export function describeProgress(row: DevLockRow): string {
  if (row.minutesWithoutProgress === undefined) return '-';
  const quiet = `no progress for ${row.minutesWithoutProgress} min`;
  return row.stalled ? `STALLED, ${quiet}` : quiet;
}

export function formatDevLocksTable(rows: DevLockRow[]): string {
  if (rows.length === 0) return 'No Development write leases or source locks are recorded.';
  return rows
    .map((row) =>
      [
        row.kind.padEnd(6),
        row.state.padEnd(8),
        row.name.padEnd(40),
        (row.ownerLabel || row.ownerId || '-').padEnd(30),
        (row.heartbeatAgeSeconds === undefined ? '-' : `${row.heartbeatAgeSeconds}s`).padEnd(6),
        describeProgress(row).padEnd(34),
        row.command ?? '',
      ].join('  '),
    )
    .join('\n');
}

async function main(): Promise<void> {
  const args = parseDevLocksArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) throw new Error('MONGODBURL is required');
  await connectScriptMongo(url);
  try {
    const db = mongoose.connection.db!;
    const target = resolveDevWriteLeaseTarget({
      databaseName: db.databaseName,
      host: mongoose.connection.host,
    });
    if (target.kind !== 'development') {
      throw new Error(
        `dev:locks reads only Development; ${db.databaseName} is not it (${target.reason}).`,
      );
    }
    const collection = devWriteLeaseCollection(db);
    const now = new Date();
    const records = await collection
      .find({ environment: DEV_WRITE_LEASE_ENVIRONMENT } as Record<string, unknown>)
      .toArray();
    const rows = describeDevLocks(records, now);
    console.log(args.json ? JSON.stringify(rows, null, 2) : formatDevLocksTable(rows));
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
