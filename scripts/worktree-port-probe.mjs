#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const CLIENT_PORT_BASE = 3000;
export const API_PORT_BASE = 4000;

const BIND_PROBE_HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'];
const CONNECT_PROBE_HOSTS = ['127.0.0.1', '::1'];
const CONNECT_TIMEOUT_MS = 500;
const LSOF_CANDIDATES = ['lsof', '/usr/sbin/lsof', '/usr/bin/lsof'];

// A listener on one address leaves every other address bindable on macOS, so the bind
// probe has to try each one; a refused bind on an absent address family is not a listener.
function bindRefusesWithAddressInUse(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve(error.code === 'EADDRINUSE'));
    server.listen({ port, host }, () => server.close(() => resolve(false)));
  });
}

function connectIsAccepted(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const settle = (accepted) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

function lsofSeesListener(port) {
  for (const command of LSOF_CANDIDATES) {
    const result = spawnSync(command, [`-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'ignore' });
    if (result.error) continue;
    return result.status === 0;
  }
  return false;
}

export async function portHasLiveListener(port, { consultLsof = true } = {}) {
  if (consultLsof && lsofSeesListener(port)) return true;
  for (const host of BIND_PROBE_HOSTS) {
    if (await bindRefusesWithAddressInUse(port, host)) return true;
  }
  for (const host of CONNECT_PROBE_HOSTS) {
    if (await connectIsAccepted(port, host)) return true;
  }
  return false;
}

export async function findFreePortOffset({
  startOffset,
  claimedApiPorts = [],
  hasLiveListener = portHasLiveListener,
}) {
  const claimed = new Set(claimedApiPorts.map(Number));
  for (let offset = startOffset; ; offset += 1) {
    const clientPort = CLIENT_PORT_BASE + offset;
    const apiPort = API_PORT_BASE + offset;
    if (claimed.has(apiPort)) continue;
    if (await hasLiveListener(clientPort)) continue;
    if (await hasLiveListener(apiPort)) continue;
    return offset;
  }
}

function parseArgs(argv) {
  const usage = 'Usage: worktree-port-probe.mjs --start-offset <n> [--claimed-api-ports "<p> <p>"]';
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(usage);
    options[flag.slice(2)] = value;
  }
  if (!/^\d+$/.test(options['start-offset'] ?? '')) throw new Error(usage);
  const claimedApiPorts = (options['claimed-api-ports'] ?? '')
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value))
    .map(Number);
  return { startOffset: Number(options['start-offset']), claimedApiPorts };
}

const isDirectRun = process.argv[1]
  ? fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    process.stdout.write(String(await findFreePortOffset(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
