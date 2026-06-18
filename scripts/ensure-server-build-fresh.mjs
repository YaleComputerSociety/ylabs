#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'server');
const buildDir = path.join(serverRoot, 'build');
const buildEntrypoint = path.join(serverRoot, 'build', 'index.js');
const forbiddenBuildArtifacts = [path.join(buildDir, 'index.js.map')];
const freshnessInputs = [
  path.join(serverRoot, 'src'),
  path.join(serverRoot, 'package.json'),
  path.join(serverRoot, 'tsconfig.json'),
  path.join(serverRoot, 'tsup.config.ts'),
];

const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);

const fail = (message) => {
  console.error(`[security] ${message}`);
  process.exit(1);
};

const newestMtimeMs = (targetPath) => {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === 'node_modules') continue;

    const child = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(child));
      continue;
    }
    if (entry.isFile() && sourceFileExtensions.has(path.extname(entry.name))) {
      newest = Math.max(newest, fs.statSync(child).mtimeMs);
    }
  }

  return newest;
};

if (!fs.existsSync(buildEntrypoint)) {
  fail('server/build/index.js is missing. Run `yarn build:server` before `yarn --cwd server start`.');
}

for (const artifact of forbiddenBuildArtifacts) {
  if (fs.existsSync(artifact)) {
    fail('server build contains source-map artifacts. Run `yarn build:server` with sourcemap disabled before start.');
  }
}

const buildMtimeMs = fs.statSync(buildEntrypoint).mtimeMs;
const sourceMtimeMs = Math.max(...freshnessInputs.map(newestMtimeMs));

if (sourceMtimeMs > buildMtimeMs + 1000) {
  fail('server/build/index.js is older than server source or build config. Run `yarn build:server` before start.');
}
