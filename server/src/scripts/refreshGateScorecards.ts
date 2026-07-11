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
 * Canonical --output paths below MUST stay in sync with the DEFAULT_*_PATH constants in
 * adminOperatorBoardService.ts.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filenameLocal = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filenameLocal), '../..');

interface Feeder {
  gate: string;
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
    output: '/tmp/ylabs-source-health.json',
  },
  {
    gate: 'dataQuality',
    script: 'beta:data-quality',
    args: ['--include-samples'],
    output: '/tmp/ylabs-beta-quality.json',
    heavy: true,
  },
  {
    gate: 'scraperIntegrity',
    script: 'scraper:integrity-gate',
    args: ['--include-samples'],
    output: '/tmp/ylabs-scraper-integrity.json',
  },
  {
    gate: 'launchTrust',
    script: 'launch:trust-contract',
    args: [
      '--collection=all',
      '--mode=student-ready-only',
      '--include-research-activity',
      '--include-paper-quality',
      '--strict',
    ],
    output: '/tmp/ylabs-launch-trust-contract.json',
  },
  {
    gate: 'launchReviewExceptions',
    script: 'launch:review-exceptions',
    args: ['--collection=all', '--limit=500', '--allow-empty-decisions'],
    output: '/tmp/ylabs-launch-review-exceptions.json',
  },
  {
    gate: 'launchAcquisition',
    script: 'launch:acquisition-report',
    args: ['--stage=all', '--limit=250', '--sample-limit=10'],
    output: '/tmp/ylabs-launch-acquisition-report.json',
  },
  {
    gate: 'betaRepairQueue',
    script: 'beta:repair-queue',
    args: ['--collection=all', '--stage=source_description', '--mode=dry-run', '--retry-blocked', '--limit=500'],
    output: '/tmp/ylabs-beta-repair-source-description.json',
  },
  {
    gate: 'productionCopy',
    script: 'production:promote-beta-copy',
    args: [],
    output: '/tmp/ylabs-lane-a-promotion-dry-run.json',
  },
];

interface FeederResult {
  gate: string;
  ok: boolean; // "ok" == the canonical artifact was (re)written this run
  exitCode: number | null; // gate scripts exit nonzero when the GATE fails to pass — that is NOT a refresh failure
  durationMs: number;
}

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

function runFeeder(feeder: Feeder, startedAt: number): Promise<FeederResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'yarn',
      [feeder.script, ...feeder.args, '--output', feeder.output],
      { cwd: SERVER_ROOT, env: process.env, stdio: 'inherit', shell: false },
    );
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

  const results: FeederResult[] = [];
  for (const feeder of selected) {
    const startedAt = Date.now();
    process.stdout.write(`\n=== gates:refresh → ${feeder.gate} (${feeder.script}) → ${feeder.output} ===\n`);
    // Sequential by design: several feeders hit the same DB and Meili; avoid contention.

    const result = await runFeeder(feeder, startedAt);
    results.push(result);
    process.stdout.write(
      `=== ${feeder.gate}: ${
        result.ok
          ? `refreshed (gate exit ${result.exitCode})`
          : `NOT REFRESHED — no artifact written (exit ${result.exitCode})`
      } in ${Math.round(result.durationMs / 1000)}s ===\n`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\ngates:refresh complete — ${results.length - failed.length}/${results.length} artifacts refreshed` +
      (failed.length ? `; NOT refreshed: ${failed.map((f) => f.gate).join(', ')}` : '') +
      '\n',
  );
  return results;
}

// Only run when invoked directly (not when imported by the scheduler).
if (process.argv[1] && path.resolve(process.argv[1]) === __filenameLocal) {
  runGateRefresh()
    .then((results) => process.exit(results.every((r) => r.ok) ? 0 : 1))
    .catch((err) => {
      console.error(sanitizeLogValue(err));
      process.exit(1);
    });
}
