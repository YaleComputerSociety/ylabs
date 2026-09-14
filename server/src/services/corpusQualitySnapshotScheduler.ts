/**
 * Keeps the Corpus Quality panel's history growing without anyone running a
 * command, using the connection the serving process already holds.
 *
 * Staleness-driven rather than interval-driven. A plain daily timer loses a day
 * whenever the process restarts or the host spins down, and this deploy is kept
 * awake by an external ping rather than by traffic, so "fire once every 24h from
 * boot" would silently skip. Instead it wakes hourly and asks whether the newest
 * row for this environment is older than the maximum age, which is correct
 * across restarts and cheap when the answer is no.
 *
 * On by default in a deployed runtime, because a measurement nobody remembers to
 * take is the problem this exists to solve. Off under NODE_ENV=test so suites
 * never write, and disableable with CORPUS_SNAPSHOT_DISABLED=true.
 */
import mongoose from 'mongoose';
import { CorpusQualitySnapshot } from '../models/corpusQualitySnapshot';
import { readCorpusQualityReport } from './corpusQualityReport';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  operatorEnvironmentForDatabaseName,
  type OperatorDatabaseEnvironment,
} from '../scripts/operatorDatabaseEnvironment';

const DEFAULT_MAX_AGE_HOURS = 24;
const MIN_MAX_AGE_HOURS = 1;
const MAX_MAX_AGE_HOURS = 24 * 30;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;
let running = false;

export function corpusSnapshotSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return false;
  return env.CORPUS_SNAPSHOT_DISABLED !== 'true';
}

export function corpusSnapshotMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env.CORPUS_SNAPSHOT_MAX_AGE_HOURS);
  const resolved = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_AGE_HOURS;
  return Math.min(Math.max(resolved, MIN_MAX_AGE_HOURS), MAX_MAX_AGE_HOURS) * 3_600_000;
}

export function connectedOperatorEnvironment(
  databaseName: string | undefined,
): OperatorDatabaseEnvironment | undefined {
  return databaseName ? operatorEnvironmentForDatabaseName(databaseName) : undefined;
}

export async function recordCorpusQualitySnapshotIfStale({
  environment,
  databaseName,
  maxAgeMs,
  now = new Date(),
}: {
  environment: OperatorDatabaseEnvironment;
  databaseName: string;
  maxAgeMs: number;
  now?: Date;
}): Promise<'recorded' | 'fresh'> {
  const newest = await CorpusQualitySnapshot.findOne({ environment })
    .sort({ measuredAt: -1 })
    .select({ measuredAt: 1 })
    .lean();

  if (newest?.measuredAt && now.getTime() - new Date(newest.measuredAt).getTime() < maxAgeMs) {
    return 'fresh';
  }

  const { generatedAt, ...measurements } = await readCorpusQualityReport(now);
  await CorpusQualitySnapshot.create({
    ...measurements,
    measuredAt: new Date(generatedAt),
    environment,
    databaseName,
  });
  return 'recorded';
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const databaseName = mongoose.connection.db?.databaseName;
    const environment = connectedOperatorEnvironment(databaseName);
    if (!environment || !databaseName) return;

    const outcome = await recordCorpusQualitySnapshotIfStale({
      environment,
      databaseName,
      maxAgeMs: corpusSnapshotMaxAgeMs(),
    });
    if (outcome === 'recorded') {
      console.log(`[corpus-snapshot] recorded a measurement for ${environment}`);
    }
  } catch (error) {
    console.error('[corpus-snapshot] measurement failed:', sanitizeLogValue(error));
  } finally {
    running = false;
  }
}

export function startCorpusQualitySnapshotScheduler(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!corpusSnapshotSchedulerEnabled(env)) return false;
  if (timer) return true;

  void tick();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopCorpusQualitySnapshotSchedulerForTests(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  running = false;
}
