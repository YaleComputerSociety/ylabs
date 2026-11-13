#!/usr/bin/env node

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { profileChildEnvironment } from './run-data-profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ROOT = path.join(REPO_ROOT, 'server');
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;
const STOP_GRACE_MS = 10_000;
const SERVED_CHECK_PROFILE = 'development';
const INTERRUPT_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const READERS = ['anonymous', 'student'];
const STUDENT_RESULT_FD = 3;

export const USAGE = [
  'Usage: node scripts/served-check.mjs [--as anonymous|student] [--api <loopback origin>] <GET path>...',
  '',
  'Reads each path as an anonymous visitor and prints one JSON line per path.',
  'Without --api it starts its own short-lived API on a free port with LOCAL_AUTH_BYPASS=false',
  'for that one process, so your dev server and every .env file keep the bypass as they are.',
  'With --api it reads an API you already run, and refuses if that API signs a cookieless request in.',
  '',
  '--as student reads each path as a synthetic signed-in undergraduate held only in memory,',
  'through the real middleware and routes of an API process that refuses every MongoDB write,',
  'and ends with a {"refusedWrites": [...]} line. It always starts its own API, so it takes no --api.',
  '',
  'Example: yarn served-check /api/research/<slug>',
  'Example: yarn served-check --as student "/api/programs/search?pageSize=500"',
].join('\n');

export function parseServedCheckArgs(argv) {
  const options = { apiBase: undefined, as: 'anonymous', paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--as') {
      const value = argv[index + 1];
      if (!READERS.includes(value)) {
        throw new Error(`--as must be one of ${READERS.join(', ')}.\n\n${USAGE}`);
      }
      options.as = value;
      index += 1;
      continue;
    }
    if (arg === '--api') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.\n\n${USAGE}`);
      options.apiBase = loopbackApiBase(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.\n\n${USAGE}`);
    options.paths.push(servedApiPath(arg));
  }
  if (options.paths.length === 0) throw new Error(`Name at least one path.\n\n${USAGE}`);
  if (options.as === 'student' && options.apiBase) {
    throw new Error(
      `--as student starts its own write-refusing API, so it takes no --api.\n\n${USAGE}`,
    );
  }
  return options;
}

function loopbackApiBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('--api must be an origin such as http://localhost:4076.');
  }
  if (
    parsed.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('--api must be a loopback http origin without credentials.');
  }
  return parsed.origin;
}

function servedApiPath(value) {
  if (!value.startsWith('/api/') || value.startsWith('//')) {
    throw new Error(`A served path must start with /api/; got ${JSON.stringify(value)}.`);
  }
  return value;
}

export function servedCheckServerEnv(profileEnv, port) {
  const env = {
    ...profileEnv,
    NODE_ENV: 'development',
    PORT: String(port),
    SERVER_BASE_URL: `http://localhost:${port}`,
    LOCAL_AUTH_BYPASS: 'false',
    CORPUS_SNAPSHOT_DISABLED: 'true',
  };
  delete env.GATE_REFRESH_INTERVAL_MINUTES;
  delete env.ALLOW_NON_PROD_SCRAPER_WRITES;
  return env;
}

export function servedCheckStudentEnv(profileEnv) {
  const env = servedCheckServerEnv(profileEnv, 0);
  delete env.PORT;
  env.SERVER_BASE_URL = 'http://localhost';
  return env;
}

export function anonymousSessionRefusal(checkStatus, checkBody) {
  if (checkStatus !== 200) {
    return `GET /api/check answered ${checkStatus}, so the session could not be confirmed anonymous.`;
  }
  if (checkBody && checkBody.auth === false && checkBody.user === undefined) return null;
  const isAdmin = checkBody?.user?.isAdmin === true;
  return [
    `GET /api/check with no cookie reported a signed-in session${isAdmin ? ' holding admin authority' : ''},`,
    'so this API has LOCAL_AUTH_BYPASS on and every read would be the bypass user, not a student,',
    'and would record a login. Nothing was read. Run without --api to get a bypass-off check server.',
  ].join(' ');
}

async function readJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    redirect: 'manual',
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export async function readServedPaths({ apiBase, paths, fetchImpl = fetch, write = console.log }) {
  const check = await readJson(fetchImpl, `${apiBase}/api/check`);
  const refusal = anonymousSessionRefusal(check.status, check.body);
  if (refusal) throw new Error(refusal);
  for (const servedPath of paths) {
    const { status, body } = await readJson(fetchImpl, `${apiBase}${servedPath}`);
    write(JSON.stringify({ path: servedPath, status, body }));
  }
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function acceptsConnections(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitUntilListening(port, child, logFile) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The check server exited with ${child.exitCode} before listening; see ${logFile}.`,
      );
    }
    if (await acceptsConnections(port)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The check server did not listen within ${READY_TIMEOUT_MS / 1000}s; see ${logFile}.`,
  );
}

function stopProcessGroup(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        resolve();
      }
    }, STOP_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      clearTimeout(forceKill);
      resolve();
    }
  });
}

const DEFAULT_SERVER_COMMAND = [
  path.join(SERVER_ROOT, 'node_modules', '.bin', 'tsx'),
  'src/index.ts',
];
const DEFAULT_STUDENT_COMMAND = [
  process.execPath,
  '--import',
  'tsx',
  'src/scripts/servedCheckStudent.ts',
];

function stopOnInterrupt(child) {
  const handlers = Object.entries(INTERRUPT_EXIT_CODES).map(([signal, exitCode]) => {
    const handler = () => {
      stopProcessGroup(child).finally(() => process.exit(exitCode));
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

async function startCheckServer(serverCommand = DEFAULT_SERVER_COMMAND) {
  const { childEnv } = profileChildEnvironment({
    profileName: SERVED_CHECK_PROFILE,
    processEnv: process.env,
  });
  const port = await freeLoopbackPort();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-served-check-'));
  const logFile = path.join(logDir, 'server.log');
  const logFd = fs.openSync(logFile, 'a', 0o600);
  const [command, ...args] = serverCommand;
  const child = spawn(command, args, {
    cwd: SERVER_ROOT,
    env: servedCheckServerEnv(childEnv, port),
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });
  fs.closeSync(logFd);
  const releaseInterruptHandlers = stopOnInterrupt(child);
  const stop = async () => {
    try {
      await stopProcessGroup(child);
    } finally {
      releaseInterruptHandlers();
    }
  };
  const apiBase = `http://localhost:${port}`;
  console.error(`Check server: pid ${child.pid}, ${apiBase}, bypass off, log ${logFile}`);
  try {
    await waitUntilListening(port, child, logFile);
  } catch (error) {
    await stop();
    throw error;
  }
  return { apiBase, stop };
}

function checkServerLogFile() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-served-check-'));
  return path.join(logDir, 'server.log');
}

export async function readServedPathsAsStudent({
  paths,
  studentCommand = DEFAULT_STUDENT_COMMAND,
  write = console.log,
}) {
  const { childEnv } = profileChildEnvironment({
    profileName: SERVED_CHECK_PROFILE,
    processEnv: process.env,
  });
  const logFile = checkServerLogFile();
  const logFd = fs.openSync(logFile, 'a', 0o600);
  const [command, ...args] = studentCommand;
  const child = spawn(command, [...args, ...paths], {
    cwd: SERVER_ROOT,
    env: servedCheckStudentEnv(childEnv),
    stdio: ['ignore', logFd, logFd, 'pipe'],
    detached: true,
  });
  fs.closeSync(logFd);
  const releaseInterruptHandlers = stopOnInterrupt(child);
  console.error(
    `Student check server: pid ${child.pid}, loopback only, writes refused, log ${logFile}`,
  );
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  let failure;
  try {
    const lines = readline.createInterface({ input: child.stdio[STUDENT_RESULT_FD] });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (typeof parsed.error === 'string') failure = parsed.error;
      else write(line);
    }
    const code = await exited;
    if (failure) throw new Error(failure);
    if (code !== 0)
      throw new Error(`The student check server exited with ${code}; see ${logFile}.`);
  } finally {
    await stopProcessGroup(child);
    releaseInterruptHandlers();
  }
}

export async function runServedCheck(argv, { serverCommand, studentCommand, write } = {}) {
  const options = parseServedCheckArgs(argv);
  if (options.as === 'student') {
    await readServedPathsAsStudent({ paths: options.paths, studentCommand, write });
    return;
  }
  if (options.apiBase) {
    await readServedPaths({ apiBase: options.apiBase, paths: options.paths, write });
    return;
  }
  const server = await startCheckServer(serverCommand);
  try {
    await readServedPaths({ apiBase: server.apiBase, paths: options.paths, write });
  } finally {
    await server.stop();
  }
}

const isDirectRun = process.argv[1]
  ? fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
  : false;

if (isDirectRun) {
  runServedCheck(process.argv.slice(2)).catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
