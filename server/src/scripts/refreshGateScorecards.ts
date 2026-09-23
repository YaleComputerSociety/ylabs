/**
 * gates:refresh — the SINGLE sanctioned writer of the canonical gate scorecard artifacts that the
 * admin operator board (/programs Gate Status) reads.
 *
 * The board (adminOperatorBoardService.ts) reads fixed canonical paths. Before this script,
 * operators regenerated them ad hoc and often wrote to *suffixed scratch files* instead, so the
 * canonical paths rotted and the board showed stale verdicts. Rule going forward:
 *   - ad-hoc / exploratory audits write to suffixed scratch files,
 *   - ONLY this script writes the canonical paths (each feeder's --output below).
 *
 * Runs each feeder sequentially, tolerating individual failures (logs + continues) so one broken
 * gate doesn't block refreshing the rest. Honors SCRAPER_ENV from the environment.
 *
 *   SCRAPER_ENV=beta yarn --cwd server gates:refresh                 # refresh all
 *   SCRAPER_ENV=beta yarn --cwd server gates:refresh --skip-heavy    # skip the ~3.5min data-quality audit
 *   SCRAPER_ENV=beta yarn --cwd server gates:refresh --only=launchTrust,betaRepairQueue
 *
 * Canonical output paths come from services/gateScorecardArtifacts.ts, which the
 * operator board reads from too, so a writer and reader can no longer disagree.
 *
 * Each feeder's summary is also stored in `gate_scorecard_snapshots`, because the
 * artifact files live under the OS temp directory and do not survive a deploy.
 * The row records what was evaluated - the command, the exit code, whether the
 * artifact was rewritten, and the database the audit itself claims - so a feeder
 * that produced nothing replaces the previous verdict with the record of its own
 * failure instead of leaving a dead verdict on the board.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { initializeConnections } from '../db/connections';
import {
  gateScorecardArtifactPath,
  type GateScorecardName,
} from '../services/gateScorecardArtifacts';
import {
  readBetaRepairQueueGateArtifact,
  readDataQualityGateArtifact,
  readLaunchAcquisitionGateArtifact,
  readLaunchReviewExceptionsArtifact,
  readLaunchTrustGateArtifact,
  readPromotionCopyDryRunArtifact,
  readScraperIntegrityGateArtifact,
} from '../services/adminOperatorBoardService';
import {
  connectedDatabaseName,
  environmentForConnectedDatabase,
  gateDetailFromNormalizedArtifact,
  writeGateScorecardSnapshot,
} from '../services/gateScorecardSnapshotStore';

const __filenameLocal = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filenameLocal), '../..');
dotenv.config({ path: path.resolve(SERVER_ROOT, '.env') });

interface Feeder {
  gate: GateScorecardName;
  script: string;
  args: string[];
  output: string;
  heavy?: boolean;
}

const FEEDERS: Feeder[] = [
  {
    gate: 'sourceHealth',
    script: 'source:health',
    args: [],
    output: gateScorecardArtifactPath('sourceHealth'),
  },
  {
    gate: 'dataQuality',
    script: 'beta:data-quality',
    args: ['--include-samples'],
    output: gateScorecardArtifactPath('dataQuality'),
    heavy: true,
  },
  {
    gate: 'scraperIntegrity',
    script: 'scraper:integrity-gate',
    args: ['--include-samples'],
    output: gateScorecardArtifactPath('scraperIntegrity'),
  },
  {
    gate: 'launchTrust',
    script: 'launch:trust-contract',
    // Paper-quality and research-activity checks are retired with the bibliographic
    // pipeline (issue #207, Phase 3); the launch-trust gate no longer enforces them.
    args: ['--collection=all', '--mode=student-ready-only', '--strict'],
    output: gateScorecardArtifactPath('launchTrust'),
  },
  {
    gate: 'launchReviewExceptions',
    script: 'launch:review-exceptions',
    args: ['--collection=all', '--limit=500', '--allow-empty-decisions'],
    output: gateScorecardArtifactPath('launchReviewExceptions'),
  },
  {
    gate: 'launchAcquisition',
    script: 'launch:acquisition-report',
    args: ['--stage=all', '--limit=250', '--sample-limit=10'],
    output: gateScorecardArtifactPath('launchAcquisition'),
  },
  {
    gate: 'betaRepairQueue',
    script: 'beta:repair-queue',
    args: [
      '--collection=all',
      '--stage=source_description',
      '--mode=dry-run',
      '--retry-blocked',
      '--limit=500',
    ],
    output: gateScorecardArtifactPath('betaRepairQueue'),
  },
  {
    gate: 'productionCopy',
    script: 'production:promote-beta-copy',
    args: [],
    output: gateScorecardArtifactPath('productionCopy'),
  },
];

interface FeederResult {
  gate: string;
  ok: boolean; // "ok" == the canonical artifact was (re)written this run
  exitCode: number | null; // gate scripts exit nonzero when the GATE fails to pass — that is NOT a refresh failure
  durationMs: number;
  stored?: 'summary' | 'failure' | 'skipped';
}

type NormalizedGateArtifact = { artifactStatus: string; generatedAt?: string } & Record<
  string,
  unknown
>;

/**
 * The board's own normalizer per gate, so the stored row holds exactly the detail
 * the matching `derive*Gate` consumes and the writer cannot invent a shape the
 * reader does not understand. `sourceHealth` is absent because the board derives
 * source freshness from the database rather than from that artifact.
 */
const GATE_SUMMARY_READERS: Partial<
  Record<GateScorecardName, (artifactPath: string) => NormalizedGateArtifact | undefined>
> = {
  dataQuality: readDataQualityGateArtifact as (p: string) => NormalizedGateArtifact | undefined,
  scraperIntegrity: readScraperIntegrityGateArtifact as (
    p: string,
  ) => NormalizedGateArtifact | undefined,
  launchTrust: readLaunchTrustGateArtifact as (p: string) => NormalizedGateArtifact | undefined,
  launchReviewExceptions: readLaunchReviewExceptionsArtifact as (
    p: string,
  ) => NormalizedGateArtifact | undefined,
  launchAcquisition: readLaunchAcquisitionGateArtifact as (
    p: string,
  ) => NormalizedGateArtifact | undefined,
  betaRepairQueue: readBetaRepairQueueGateArtifact as (
    p: string,
  ) => NormalizedGateArtifact | undefined,
  productionCopy: readPromotionCopyDryRunArtifact as (
    p: string,
  ) => NormalizedGateArtifact | undefined,
};

export function feederCommandLine(feeder: Feeder): string {
  return ['yarn', feeder.script, ...feeder.args].join(' ');
}

function artifactProvenance(artifactPath: string): {
  artifactDatabase?: string;
  artifactEnvironment?: string;
} {
  try {
    const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const database = typeof parsed?.db === 'string' ? parsed.db.split('/').pop() : undefined;
    return {
      ...(database ? { artifactDatabase: database } : {}),
      ...(typeof parsed?.environment === 'string'
        ? { artifactEnvironment: parsed.environment }
        : {}),
    };
  } catch {
    return {};
  }
}

export function describeStoredScorecard(
  result: Pick<FeederResult, 'ok'>,
  normalized: NormalizedGateArtifact | undefined,
): { summary?: Record<string, unknown>; failureReason?: string } {
  if (!result.ok) return { failureReason: 'the feeder wrote no scorecard' };
  if (!normalized) return { failureReason: 'the scorecard could not be read back' };
  if (normalized.artifactStatus !== 'loaded') {
    return { failureReason: `the scorecard read back as ${normalized.artifactStatus}` };
  }
  return { summary: gateDetailFromNormalizedArtifact(normalized) };
}

async function storeFeederScorecard(
  feeder: Feeder,
  result: FeederResult,
  context: { refreshRunId: string; databaseName: string; environment: string },
): Promise<FeederResult['stored']> {
  const reader = GATE_SUMMARY_READERS[feeder.gate];
  if (!reader || !context.databaseName) return 'skipped';

  const normalized = result.ok ? reader(feeder.output) : undefined;
  const { summary, failureReason } = describeStoredScorecard(result, normalized);
  const artifactGeneratedAt =
    typeof normalized?.generatedAt === 'string' ? normalized.generatedAt : undefined;
  const measuredAt = summary && artifactGeneratedAt ? new Date(artifactGeneratedAt) : new Date();

  await writeGateScorecardSnapshot({
    gate: feeder.gate,
    environment: context.environment,
    databaseName: context.databaseName,
    measuredAt: Number.isNaN(measuredAt.getTime()) ? new Date() : measuredAt,
    storedAt: new Date(),
    refreshRunId: context.refreshRunId,
    evaluated: {
      command: feederCommandLine(feeder),
      exitCode: result.exitCode,
      artifactWritten: result.ok,
      artifactPath: feeder.output,
      ...(artifactGeneratedAt ? { artifactGeneratedAt } : {}),
      ...(result.ok ? artifactProvenance(feeder.output) : {}),
      ...(failureReason ? { failureReason } : {}),
    },
    summary,
  });
  return summary ? 'summary' : 'failure';
}

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

function runFeeder(feeder: Feeder, startedAt: number): Promise<FeederResult> {
  return new Promise((resolve) => {
    const child = spawn('yarn', [feeder.script, ...feeder.args, '--output', feeder.output], {
      cwd: SERVER_ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => {
      // Success = the canonical artifact was written/updated during this run. A gate script that
      // exits nonzero because its gate did not PASS (e.g. launch-trust has held rows) still writes
      // a valid, current scorecard — that is a successful refresh, not a failure.
      let wrote = false;
      try {
        wrote = fs.existsSync(feeder.output) && fs.statSync(feeder.output).mtimeMs >= startedAt;
      } catch {
        wrote = false;
      }
      resolve({
        gate: feeder.gate,
        ok: wrote,
        exitCode: code,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('error', () => {
      resolve({ gate: feeder.gate, ok: false, exitCode: null, durationMs: Date.now() - startedAt });
    });
  });
}

export async function runGateRefresh(): Promise<FeederResult[]> {
  const skipHeavy = process.argv.includes('--skip-heavy');
  const only = (argValue('--only') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const selected = FEEDERS.filter((f) => {
    if (only.length && !only.includes(f.gate)) return false;
    if (skipHeavy && f.heavy) return false;
    return true;
  });

  const refreshRunId = randomUUID();
  const databaseName = connectedDatabaseName();
  const environment = environmentForConnectedDatabase(databaseName);
  process.stdout.write(
    `gates:refresh run ${refreshRunId} storing summaries for ${environment} (${databaseName || 'no database connection'})\n`,
  );

  const results: FeederResult[] = [];
  const storeFailures: string[] = [];
  for (const feeder of selected) {
    const startedAt = Date.now();
    process.stdout.write(
      `\n=== gates:refresh → ${feeder.gate} (${feeder.script}) → ${feeder.output} ===\n`,
    );
    // Sequential by design: several feeders hit the same DB and Meili; avoid contention.

    const result = await runFeeder(feeder, startedAt);
    try {
      result.stored = await storeFeederScorecard(feeder, result, {
        refreshRunId,
        databaseName,
        environment,
      });
    } catch (error) {
      storeFailures.push(feeder.gate);
      console.error(`[gates:refresh] could not store ${feeder.gate}:`, sanitizeLogValue(error));
    }
    results.push(result);
    process.stdout.write(
      `=== ${feeder.gate}: ${
        result.ok
          ? `refreshed (gate exit ${result.exitCode})`
          : `NOT REFRESHED — no artifact written (exit ${result.exitCode})`
      } in ${Math.round(result.durationMs / 1000)}s; stored ${result.stored ?? 'not stored'} ===\n`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\ngates:refresh complete — ${results.length - failed.length}/${results.length} artifacts refreshed` +
      (failed.length ? `; NOT refreshed: ${failed.map((f) => f.gate).join(', ')}` : '') +
      (storeFailures.length ? `; NOT stored: ${storeFailures.join(', ')}` : '') +
      '\n',
  );
  if (storeFailures.length) {
    throw new Error(
      `gates:refresh could not store ${storeFailures.length} summaries, so the board would keep serving the previous verdict: ${storeFailures.join(', ')}`,
    );
  }
  return results;
}

// Only run when invoked directly (not when imported by the scheduler).
if (process.argv[1] && path.resolve(process.argv[1]) === __filenameLocal) {
  initializeConnections()
    .then(() => runGateRefresh())
    .then(async (results) => {
      await mongoose.disconnect();
      process.exit(results.every((r) => r.ok) ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(sanitizeLogValue(err));
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    });
}
