/**
 * Reads and writes the stored gate scorecard summaries the admin operator board
 * renders.
 *
 * The board used to read JSON files under the OS temp directory, so a verdict
 * vanished on every deploy and no scheduled runner could populate one. A row in
 * `gate_scorecard_snapshots` survives a deploy and any runner with the
 * connection string can write it.
 *
 * Rows are keyed by the connected database rather than by a claimed environment
 * name, so a row copied into the wrong database cannot be read as that
 * database's verdict.
 */
import mongoose from 'mongoose';
import {
  GateScorecardSnapshot,
  GATE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/gateScorecardSnapshot';
import { operatorEnvironmentForDatabaseName } from '../scripts/operatorDatabaseEnvironment';
import { GATE_SCORECARD_NAMES, type GateScorecardName } from './gateScorecardArtifacts';

export interface GateScorecardEvaluation {
  command: string;
  exitCode: number | null;
  artifactWritten: boolean;
  artifactPath?: string;
  artifactGeneratedAt?: string;
  artifactDatabase?: string;
  artifactEnvironment?: string;
  failureReason?: string;
}

export interface StoredGateScorecard {
  gate: GateScorecardName;
  environment: string;
  databaseName: string;
  measuredAt: Date;
  storedAt: Date;
  refreshRunId: string;
  evaluated: GateScorecardEvaluation;
  summary?: Record<string, unknown>;
}

export interface StoredGateArtifactStatus {
  artifactStatus: 'loaded' | 'stale' | 'invalid';
  artifactPath: string;
  generatedAt?: string;
  ageHours?: number;
  error?: string;
}

/** Provenance fields the row owns, so a stored summary carries only gate detail. */
const ROW_OWNED_SUMMARY_KEYS = ['artifactStatus', 'artifactPath', 'generatedAt'] as const;

export function storedGateScorecardPathLabel(gate: string): string {
  return `${GATE_SCORECARD_SNAPSHOT_COLLECTION}:${gate}`;
}

export function connectedDatabaseName(): string {
  return mongoose.connection.db?.databaseName || '';
}

export function environmentForConnectedDatabase(databaseName: string): string {
  return operatorEnvironmentForDatabaseName(databaseName) || 'unknown';
}

export function gateDetailFromNormalizedArtifact(
  artifact: Record<string, unknown>,
): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(artifact)) {
    if ((ROW_OWNED_SUMMARY_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined) continue;
    detail[key] = value;
  }
  return detail;
}

/**
 * What a refresh produced for one gate: the detail to store, or the reason there
 * is nothing to store. A failed feeder must be recorded rather than skipped, or
 * the board keeps rendering a verdict whose refresh never ran.
 */
export function describeGateRefreshOutcome(
  artifactWritten: boolean,
  normalized: { artifactStatus?: unknown } | undefined,
): { summary?: Record<string, unknown>; failureReason?: string } {
  if (!artifactWritten) return { failureReason: 'the feeder wrote no scorecard' };
  if (!normalized) return { failureReason: 'the scorecard could not be read back' };
  if (normalized.artifactStatus !== 'loaded') {
    return { failureReason: `the scorecard read back as ${String(normalized.artifactStatus)}` };
  }
  return { summary: gateDetailFromNormalizedArtifact(normalized as Record<string, unknown>) };
}

export async function writeGateScorecardSnapshot(snapshot: StoredGateScorecard): Promise<void> {
  const { gate, databaseName, ...rest } = snapshot;
  await GateScorecardSnapshot.findOneAndUpdate(
    { gate, databaseName },
    { $set: { gate, databaseName, ...rest, summary: snapshot.summary ?? null } },
    { upsert: true },
  );
}

export async function readStoredGateScorecards(
  databaseName = connectedDatabaseName(),
): Promise<Map<GateScorecardName, StoredGateScorecard>> {
  const rows = new Map<GateScorecardName, StoredGateScorecard>();
  if (!databaseName) return rows;
  const documents = await GateScorecardSnapshot.find({
    databaseName,
    gate: { $in: GATE_SCORECARD_NAMES },
  }).lean();
  for (const document of documents as unknown as StoredGateScorecard[]) {
    rows.set(document.gate, {
      ...document,
      measuredAt: new Date(document.measuredAt),
      storedAt: new Date(document.storedAt),
    });
  }
  return rows;
}

/**
 * The stored row is authoritative unless an artifact file on disk was generated
 * after it, which is how a hand-run during the file-to-row transition still
 * shows, and how a refresh that produced nothing still replaces an older verdict
 * with the record of its own failure instead of being masked by the file it
 * failed to rewrite.
 */
export function storedScorecardSupersedesFile(
  stored: StoredGateScorecard | undefined,
  fileGeneratedAt: string | undefined,
): boolean {
  if (!stored) return false;
  if (!fileGeneratedAt) return true;
  const fileTime = new Date(fileGeneratedAt).getTime();
  if (Number.isNaN(fileTime)) return true;
  return stored.measuredAt.getTime() >= fileTime;
}

export function storedGateArtifact<T>(
  stored: StoredGateScorecard | undefined,
  maxAgeHours: number,
  now = new Date(),
): T | undefined {
  if (!stored) return undefined;
  const artifactPath = storedGateScorecardPathLabel(stored.gate);
  if (!stored.summary) {
    const reason = stored.evaluated.failureReason || 'the feeder wrote no scorecard';
    return {
      artifactStatus: 'invalid',
      artifactPath,
      error:
        `Gate refresh ${stored.refreshRunId} could not evaluate this gate: ${reason} ` +
        `(exit ${stored.evaluated.exitCode ?? 'none'})`,
    } as T;
  }
  const generatedAt = stored.measuredAt.toISOString();
  const ageHours = Math.floor((now.getTime() - stored.measuredAt.getTime()) / (60 * 60 * 1000));
  if (ageHours > maxAgeHours) {
    return { artifactStatus: 'stale', artifactPath, generatedAt, ageHours } as T;
  }
  return {
    artifactStatus: 'loaded',
    artifactPath,
    generatedAt,
    ...stored.summary,
  } as T;
}
