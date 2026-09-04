#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditedWorkspaceDirectories, auditWorkspaces } from './dependency-audit-core.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const auditArguments = process.argv.slice(2);
const yarnExecutable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

const runAudit = ({ directory }) => {
  const result = spawnSync(yarnExecutable, ['npm', 'audit', ...auditArguments], {
    cwd: path.join(repoRoot, directory),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { exitCode: result.status ?? 1, output };
};

const waitBeforeRetry = (delayMs, { directory, attempt }) => {
  console.error(
    `Dependency audit for "${directory}" could not reach the npm registry (attempt ${attempt}); retrying in ${delayMs}ms.`,
  );
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const outcome = await auditWorkspaces({ runAudit, waitBeforeRetry });

if (!outcome.ok) {
  console.error(
    outcome.reason === 'registry-unavailable'
      ? `Dependency audit for "${outcome.directory}" could not reach the npm registry after ${outcome.attempt} attempts.`
      : `Dependency audit for "${outcome.directory}" reported advisories at or above the requested severity.`,
  );
  process.exit(outcome.exitCode || 1);
}

console.log(
  `No dependency advisories at or above the requested severity in: ${auditedWorkspaceDirectories.join(', ')}.`,
);
