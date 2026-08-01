#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  GRAPHIFY_ARTIFACTS,
  cacheRefreshReasons,
  hashInputs,
  isGraphInputPath,
  parseInstalledGraphifyVersion,
  parseReportSourceCommit,
} from './graphify-cache-core.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const statePath = path.join(root, 'graphify-out/.cache-state.json');
const mode = process.argv[2] || 'ensure';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return options.capture ? String(result.stdout || '') : '';
};

const readExpectedVersion = () => readFileSync(path.join(root, '.graphify-version'), 'utf8').trim();

const installedVersion = () => {
  const result = spawnSync('graphify', ['--version'], { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return parseInstalledGraphifyVersion(result.stdout);
};

const head = () => run('git', ['rev-parse', 'HEAD'], { capture: true }).trim();

const graphInputFingerprint = () => {
  const output = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    capture: true,
  });
  const entries = output
    .split('\0')
    .filter(isGraphInputPath)
    .map((filePath) => ({
      path: filePath,
      content: existsSync(path.join(root, filePath))
        ? readFileSync(path.join(root, filePath))
        : '<deleted>',
    }));
  return hashInputs(entries);
};

const readState = () => {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
};

const reportSourceCommit = () => {
  const reportPath = path.join(root, 'graphify-out/GRAPH_REPORT.md');
  if (!existsSync(reportPath)) return '';
  return parseReportSourceCommit(readFileSync(reportPath, 'utf8'));
};

const validateArtifacts = () => {
  for (const artifact of GRAPHIFY_ARTIFACTS) {
    if (!existsSync(path.join(root, artifact))) throw new Error(`${artifact} was not generated`);
  }
  const graph = JSON.parse(readFileSync(path.join(root, GRAPHIFY_ARTIFACTS[0]), 'utf8'));
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length === 0 ||
    !Array.isArray(graph.links) ||
    graph.links.length === 0
  ) {
    throw new Error('graphify-out/graph.json must contain non-empty nodes and links arrays');
  }
};

const writeState = () => {
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        graphifyVersion: readExpectedVersion(),
        head: head(),
        inputFingerprint: graphInputFingerprint(),
        refreshedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
};

const assertInstalledVersion = () => {
  const expected = readExpectedVersion();
  const installed = installedVersion();
  if (!installed) {
    throw new Error(
      `Graphify is not installed. Install graphifyy==${expected}, then rerun this command.`,
    );
  }
  if (installed !== expected) {
    throw new Error(`Installed Graphify ${installed} does not match required ${expected}`);
  }
};

const refresh = () => {
  assertInstalledVersion();
  run('graphify', ['update', '.', '--force']);
  validateArtifacts();
  writeState();
  console.log(`Graphify cache refreshed for ${head().slice(0, 12)}.`);
};

const policy = () => {
  const tracked = run('git', ['ls-files', '-z', '--', 'graphify-out'], { capture: true })
    .split('\0')
    .filter(Boolean);
  if (tracked.length > 0) {
    throw new Error(`Generated Graphify files must not be tracked: ${tracked.join(', ')}`);
  }
  for (const artifact of [...GRAPHIFY_ARTIFACTS, 'graphify-out/.cache-state.json']) {
    const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', artifact], {
      cwd: root,
    });
    if (result.status !== 0) throw new Error(`${artifact} must be ignored by Git`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(readExpectedVersion())) {
    throw new Error('.graphify-version must contain an exact semantic version');
  }
  console.log('Graphify cache policy is valid.');
};

const artifactHash = () => {
  const hash = createHash('sha256');
  for (const artifact of GRAPHIFY_ARTIFACTS) {
    hash.update(artifact);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, artifact)));
    hash.update('\0');
  }
  return hash.digest('hex');
};

const verify = () => {
  policy();
  assertInstalledVersion();
  run('graphify', ['update', '.', '--force']);
  validateArtifacts();
  const firstHash = artifactHash();
  run('graphify', ['update', '.', '--force']);
  validateArtifacts();
  const secondHash = artifactHash();
  if (firstHash !== secondHash) {
    throw new Error('Graphify output changed on the second update');
  }
  writeState();
  console.log(`Graphify generated deterministically with digest ${secondHash}.`);
};

const status = () => {
  const expectedVersion = readExpectedVersion();
  const currentHead = head();
  const fingerprint = graphInputFingerprint();
  const artifactsExist = GRAPHIFY_ARTIFACTS.every((artifact) =>
    existsSync(path.join(root, artifact)),
  );
  const state = readState();
  const reasons = cacheRefreshReasons({
    artifactsExist,
    expectedVersion,
    installedVersion: installedVersion(),
    head: currentHead,
    reportCommit: reportSourceCommit(),
    inputFingerprint: fingerprint,
    state,
  });
  console.log(
    JSON.stringify(
      {
        fresh: reasons.length === 0,
        head: currentHead,
        expectedVersion,
        reportCommit: reportSourceCommit() || null,
        reasons,
      },
      null,
      2,
    ),
  );
  return reasons;
};

try {
  switch (mode) {
    case 'ensure': {
      const reasons = status();
      if (reasons.length > 0) refresh();
      break;
    }
    case 'refresh':
      refresh();
      break;
    case 'status':
      status();
      break;
    case 'policy':
      policy();
      break;
    case 'verify':
      verify();
      break;
    default:
      throw new Error(`Unknown mode ${mode}. Use ensure, refresh, status, policy, or verify.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
