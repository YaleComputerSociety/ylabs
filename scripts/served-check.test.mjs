import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PROFILES } from './run-data-profile.mjs';
import {
  anonymousSessionRefusal,
  parseServedCheckArgs,
  readServedPaths,
  runServedCheck,
  servedCheckServerEnv,
} from './served-check.mjs';

const BYPASS_ON_DOTENV = [
  'MONGODBURL=mongodb+srv://example.mongodb.net/Development',
  'SCRAPER_ENV=development',
  'PORT=4038',
  'SERVER_BASE_URL=http://localhost:4038',
  'LOCAL_AUTH_BYPASS=true',
  'LOCAL_AUTH_BYPASS_NETID=devadmin',
  'LOCAL_AUTH_BYPASS_USER_TYPE=admin',
  'ALLOW_NON_PROD_SCRAPER_WRITES=true',
  'GATE_REFRESH_INTERVAL_MINUTES=30',
  '',
].join('\n');

const withSyntheticDevelopmentProfile = async (callback) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-served-check-profile-'));
  const dotEnvFile = path.join(dir, '.env');
  fs.writeFileSync(dotEnvFile, BYPASS_ON_DOTENV);
  const originalFile = PROFILES.development.file;
  const originalShell = process.env.LOCAL_AUTH_BYPASS;
  try {
    PROFILES.development.file = dotEnvFile;
    delete process.env.LOCAL_AUTH_BYPASS;
    return await callback(dir);
  } finally {
    PROFILES.development.file = originalFile;
    if (originalShell === undefined) delete process.env.LOCAL_AUTH_BYPASS;
    else process.env.LOCAL_AUTH_BYPASS = originalShell;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const startFakeApi = (checkBody) =>
  new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/api/check' ? checkBody : { served: req.url }));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({
        apiBase: `http://localhost:${server.address().port}`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });

test('the check server env turns the bypass off and takes its own port over server/.env', () => {
  const env = servedCheckServerEnv(
    {
      PORT: '4038',
      SERVER_BASE_URL: 'http://localhost:4038',
      LOCAL_AUTH_BYPASS: 'true',
      ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      GATE_REFRESH_INTERVAL_MINUTES: '30',
    },
    4123,
  );
  assert.equal(env.LOCAL_AUTH_BYPASS, 'false');
  assert.equal(env.PORT, '4123');
  assert.equal(env.SERVER_BASE_URL, 'http://localhost:4123');
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.CORPUS_SNAPSHOT_DISABLED, 'true');
  assert.equal('ALLOW_NON_PROD_SCRAPER_WRITES' in env, false);
  assert.equal('GATE_REFRESH_INTERVAL_MINUTES' in env, false);
});

test('only a 200 anonymous /api/check answer passes the guard', () => {
  assert.equal(anonymousSessionRefusal(200, { auth: false }), null);
  assert.match(
    anonymousSessionRefusal(200, { auth: true, user: { isAdmin: true } }),
    /signed-in session holding admin authority[\s\S]*Nothing was read/,
  );
  assert.match(anonymousSessionRefusal(200, { auth: true, user: {} }), /signed-in session,/);
  assert.match(anonymousSessionRefusal(200, { auth: false, user: {} }), /signed-in session/);
  assert.match(anonymousSessionRefusal(200, 'not json'), /signed-in session/);
  assert.match(anonymousSessionRefusal(500, { auth: false }), /answered 500/);
});

test('an API with the bypass on is refused before any served path is read', async () => {
  const api = await startFakeApi({ auth: true, user: { isAdmin: true } });
  const lines = [];
  try {
    await assert.rejects(
      readServedPaths({
        apiBase: api.apiBase,
        paths: ['/api/research/synthetic-row'],
        write: (line) => lines.push(line),
      }),
      /LOCAL_AUTH_BYPASS on/,
    );
    assert.deepEqual(api.seen, ['/api/check']);
    assert.deepEqual(lines, []);
  } finally {
    await api.close();
  }
});

test('an anonymous API has each served path read and reported', async () => {
  const api = await startFakeApi({ auth: false });
  const lines = [];
  try {
    await runServedCheck(['--api', api.apiBase, '/api/research/synthetic-row'], {
      write: (line) => lines.push(line),
    });
    assert.deepEqual(api.seen, ['/api/check', '/api/research/synthetic-row']);
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [
        {
          path: '/api/research/synthetic-row',
          status: 200,
          body: { served: '/api/research/synthetic-row' },
        },
      ],
    );
  } finally {
    await api.close();
  }
});

test('arguments accept only /api/ paths and a loopback --api origin', () => {
  assert.deepEqual(parseServedCheckArgs(['/api/research/x']), {
    apiBase: undefined,
    paths: ['/api/research/x'],
  });
  assert.throws(() => parseServedCheckArgs([]), /at least one path/);
  assert.throws(
    () => parseServedCheckArgs(['https://example.com/api/x']),
    /must start with \/api\//,
  );
  assert.throws(() => parseServedCheckArgs(['--api', 'https://example.com', '/api/x']), /loopback/);
  assert.throws(() => parseServedCheckArgs(['--profile', 'local', '/api/x']), /Unknown option/);
});

const FAKE_SERVER_SOURCE = `
const http = require('http');
const bypassOn = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_AUTH_BYPASS || '').toLowerCase());
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/check') {
    res.end(JSON.stringify(bypassOn ? { auth: true, user: { isAdmin: true } } : { auth: false }));
    return;
  }
  res.end(JSON.stringify({ port: process.env.PORT, bypass: process.env.LOCAL_AUTH_BYPASS }));
}).listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`;

test('a self-started check server runs with the bypass off even when server/.env turns it on', async () => {
  await withSyntheticDevelopmentProfile(async (dir) => {
    const serverScript = path.join(dir, 'fake-server.cjs');
    fs.writeFileSync(serverScript, FAKE_SERVER_SOURCE);
    const lines = [];
    await runServedCheck(['/api/research/synthetic-row'], {
      serverCommand: [process.execPath, serverScript],
      write: (line) => lines.push(line),
    });
    assert.equal(lines.length, 1);
    const { path: servedPath, status, body } = JSON.parse(lines[0]);
    assert.equal(servedPath, '/api/research/synthetic-row');
    assert.equal(status, 200);
    assert.equal(body.bypass, 'false');
    assert.notEqual(body.port, '4038');
  });
});

test('a self-started check run leaves no signal listeners behind', async () => {
  await withSyntheticDevelopmentProfile(async (dir) => {
    const serverScript = path.join(dir, 'fake-server.cjs');
    fs.writeFileSync(serverScript, FAKE_SERVER_SOURCE);
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    await runServedCheck(['/api/research/synthetic-row'], {
      serverCommand: [process.execPath, serverScript],
      write: () => {},
    });
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  });
});

const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

test('interrupting a run during server startup stops the check server it started', async () => {
  await withSyntheticDevelopmentProfile(async (dir) => {
    const pidFile = path.join(dir, 'server.pid');
    const serverScript = path.join(dir, 'never-listening-server.cjs');
    fs.writeFileSync(
      serverScript,
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const runnerScript = path.join(dir, 'runner.mjs');
    fs.writeFileSync(
      runnerScript,
      [
        `import { PROFILES } from ${JSON.stringify(new URL('./run-data-profile.mjs', import.meta.url).href)};`,
        `import { runServedCheck } from ${JSON.stringify(new URL('./served-check.mjs', import.meta.url).href)};`,
        `PROFILES.development.file = ${JSON.stringify(path.join(dir, '.env'))};`,
        `await runServedCheck(['/api/research/synthetic-row'], { serverCommand: [${JSON.stringify(process.execPath)}, ${JSON.stringify(serverScript)}] });`,
        '',
      ].join('\n'),
    );
    const { spawn } = await import('node:child_process');
    const runner = spawn(process.execPath, [runnerScript], { stdio: 'ignore' });
    const exited = new Promise((resolve) => runner.once('exit', (code) => resolve(code)));
    try {
      assert.ok(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8')));
      const serverPid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert.ok(processIsAlive(serverPid));
      runner.kill('SIGINT');
      assert.equal(await exited, 130);
      assert.ok(await waitFor(() => !processIsAlive(serverPid)));
    } finally {
      if (runner.exitCode === null) runner.kill('SIGKILL');
      const serverPid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
      if (serverPid && processIsAlive(serverPid)) process.kill(serverPid, 'SIGKILL');
    }
  });
});
