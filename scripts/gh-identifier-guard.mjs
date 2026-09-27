#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARDED_ORG, planGuard } from './gh-identifier-guard-core.mjs';

const args = process.argv.slice(2);
const guardDir = path.dirname(fileURLToPath(import.meta.url));
const scannerPath = path.join(guardDir, 'check-no-person-identifiers.mjs');

const realpathOrNull = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// The installed shim is itself named gh and sits first on PATH, so it has to be
// skipped along with this file or the guard would exec itself forever.
const skippedPaths = new Set(
  [process.argv[1], process.env.GH_IDENTIFIER_GUARD_SHIM].filter(Boolean).map(realpathOrNull),
);

const isExecutable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findRealGh = () => {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const resolved = realpathOrNull(path.join(dir, 'gh'));
    if (resolved && !skippedPaths.has(resolved) && isExecutable(resolved)) return resolved;
  }
  console.error('gh guard: could not find the real gh binary on PATH');
  process.exit(127);
};

let stdinBuffer = null;
const readStdinOnce = () => {
  if (stdinBuffer === null) stdinBuffer = fs.readFileSync(0);
  return stdinBuffer.toString('utf8');
};

const runRealGh = () => {
  const result = spawnSync(findRealGh(), args, {
    stdio: [stdinBuffer === null ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    input: stdinBuffer ?? undefined,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
};

const git = (gitArgs) => {
  try {
    return execFileSync('git', gitArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const plan = planGuard(args, {
  envRepo: process.env.GH_REPO,
  originUrl: git(['remote', 'get-url', 'origin']),
  readBodyFile: (file) => (file === '-' ? readStdinOnce() : fs.readFileSync(file, 'utf8')),
  branchCommitMessages: (base) => git(['log', '--format=%B', `origin/${base}..HEAD`]),
});

if (plan.action === 'passthrough') runRealGh();

if (!fs.existsSync(scannerPath)) {
  console.error(
    `gh guard: NOT posted to a ${GUARDED_ORG} repo, because the person identifier scanner is missing at ${scannerPath}`,
  );
  process.exit(1);
}

const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-guard-'));
const draftFile = path.join(draftDir, 'body.md');
fs.writeFileSync(draftFile, plan.text, { mode: 0o600 });
const scan = spawnSync(
  process.execPath,
  [scannerPath, '--body-file', draftFile, '--label', plan.label],
  { cwd: guardDir, encoding: 'utf8' },
);

if (scan.status !== 0) {
  process.stderr.write(scan.stdout ?? '');
  process.stderr.write(scan.stderr ?? '');
  console.error(
    '\ngh guard: NOT posted. Nothing reached GitHub. Rewrite the text by predicate and re-run.' +
      `\nRejected draft kept locally at ${draftFile}` +
      '\nCheck a draft with: yarn security:identifiers:body <file>',
  );
  process.exit(1);
}

fs.rmSync(draftDir, { recursive: true, force: true });

runRealGh();
