import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const REPORT_MODULE = path.resolve(__dirname, '../scriptDiagnosticReport.ts');
// tsx listens on a unix socket under TMPDIR, whose path must stay under the platform length limit.
const SHORT_TEMP_ROOT = process.platform === 'win32' ? os.tmpdir() : '/tmp';
const CANARY_VALUE = 'synthetic-canary-credential-5945';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function startStalledScriptWithAWorker(): {
  child: ChildProcessWithoutNullStreams;
  reportDirectory: string;
} {
  const workDirectory = fs.mkdtempSync(path.join(SHORT_TEMP_ROOT, 'srt-'));
  const reportDirectory = path.join(workDirectory, 'tmp');
  fs.mkdirSync(reportDirectory);
  const scriptPath = path.join(workDirectory, 'stalled.ts');
  fs.writeFileSync(
    scriptPath,
    [
      `import { Worker } from 'worker_threads';`,
      `import { enableScriptDiagnosticReportOnSignal } from ${JSON.stringify(REPORT_MODULE)};`,
      `enableScriptDiagnosticReportOnSignal();`,
      `new Worker('setInterval(() => {}, 1000)', { eval: true }).on('online', () => console.log('ready'));`,
      `setInterval(() => {}, 1000);`,
    ].join('\n'),
  );
  const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      TMPDIR: reportDirectory,
      MONGODBURL: `mongodb://127.0.0.1:1/${CANARY_VALUE}`,
      SCRIPT_REPORT_CANARY: CANARY_VALUE,
    },
  });
  cleanups.push(() => {
    child.kill('SIGKILL');
    fs.rmSync(workDirectory, { recursive: true, force: true });
  });
  return { child, reportDirectory };
}

function waitForOutput(stream: NodeJS.ReadableStream, pattern: RegExp): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${pattern}: ${seen}`)),
      20_000,
    );
    stream.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      const match = seen.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
  });
}

type ReportSection = {
  environmentVariables?: unknown;
  javascriptStack?: unknown;
  header?: { trigger?: string };
  workers?: ReportSection[];
};

describe('a script process stalled on an await (#5945)', () => {
  it('writes a report with no environment on SIGUSR2, from the main thread and every worker, and keeps running', async () => {
    const { child, reportDirectory } = startStalledScriptWithAWorker();
    await waitForOutput(child.stdout, /ready/);

    const written = waitForOutput(child.stderr, /Diagnostic report written to (\S+\.json)/);
    child.kill('SIGUSR2');
    const reportPath = (await written)[1];

    expect(fs.readdirSync(reportDirectory)).toContain(path.basename(reportPath));
    expect(fs.statSync(reportPath).mode & 0o777).toBe(0o600);

    const raw = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw) as ReportSection;
    expect(report.javascriptStack).toBeDefined();
    expect(report.workers?.length ?? 0).toBeGreaterThan(0);
    expect(report.environmentVariables).toBeUndefined();
    for (const worker of report.workers ?? []) {
      expect(worker.environmentVariables).toBeUndefined();
    }
    expect(raw).not.toContain(CANARY_VALUE);

    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });
});
