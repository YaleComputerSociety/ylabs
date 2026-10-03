#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PRIVATE_FILE_MODE = 0o600;

export function upsertEnvValues(text, values) {
  const pending = new Map(Object.entries(values));
  const written = new Set();
  const lines = text.length > 0 ? text.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const output = [];
  for (const line of lines) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key === undefined || !pending.has(key)) {
      output.push(line);
      continue;
    }
    if (written.has(key)) continue;
    output.push(`${key}=${pending.get(key)}`);
    written.add(key);
  }
  for (const [key, value] of pending) {
    if (!written.has(key)) output.push(`${key}=${value}`);
  }
  return `${output.join('\n')}\n`;
}

function writePrivateFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(file, PRIVATE_FILE_MODE);
}

function prepareEnvFile({ label, primaryFile, worktreeFile, values, generateWhenMissing }) {
  const keys = Object.keys(values);
  if (fs.existsSync(primaryFile)) {
    writePrivateFile(worktreeFile, upsertEnvValues(fs.readFileSync(primaryFile, 'utf8'), values));
    return { label, keys, ready: true, source: 'primary' };
  }
  if (generateWhenMissing) {
    writePrivateFile(worktreeFile, upsertEnvValues('', values));
    return { label, keys, ready: true, source: 'generated' };
  }
  return { label, keys, ready: false, source: 'missing' };
}

export function prepareWorktreeEnv({ primaryRoot, worktreeRoot, serverPort }) {
  const serverOrigin = `http://localhost:${serverPort}`;
  const server = prepareEnvFile({
    label: 'server/.env',
    primaryFile: path.join(primaryRoot, 'server', '.env'),
    worktreeFile: path.join(worktreeRoot, 'server', '.env'),
    values: { PORT: String(serverPort), SERVER_BASE_URL: serverOrigin },
  });
  const client = prepareEnvFile({
    label: 'client/.env',
    primaryFile: path.join(primaryRoot, 'client', '.env'),
    worktreeFile: path.join(worktreeRoot, 'client', '.env'),
    values: { VITE_APP_SERVER: serverOrigin },
    generateWhenMissing: true,
  });
  return { server, client };
}

export function describePreparedEnv({ server, client }, primaryRoot) {
  return [server, client].map((result) =>
    result.source === 'primary'
      ? `  ${result.label}: copied from the primary checkout (${primaryRoot}), mode 0600, ports written`
      : result.source === 'generated'
        ? `  ${result.label}: the primary checkout has none, so it was created holding only ${result.keys.join(' and ')}, mode 0600`
        : `  ${result.label}: MISSING. The primary checkout has no ${result.label}, so nothing was copied. Create it from ${result.label}.example (see DEVELOPER_GUIDE.md), then set ${result.keys.join(' and ')} to the ports above.`,
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(
        'Usage: prepare-worktree-env.mjs --primary <dir> --worktree <dir> --server-port <n>',
      );
    }
    options[flag.slice(2)] = value;
  }
  for (const required of ['primary', 'worktree', 'server-port']) {
    if (!options[required]) throw new Error(`Missing --${required}.`);
  }
  if (!/^\d+$/.test(options['server-port']))
    throw new Error('--server-port must be a port number.');
  return {
    primaryRoot: options.primary,
    worktreeRoot: options.worktree,
    serverPort: Number(options['server-port']),
  };
}

const isDirectRun = process.argv[1]
  ? fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = prepareWorktreeEnv(options);
    console.log(describePreparedEnv(result, options.primaryRoot).join('\n'));
    process.exitCode = result.server.ready ? 0 : 2;
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
