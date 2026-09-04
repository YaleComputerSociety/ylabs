import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isRegistryUnavailableFailure,
  runAuditWithRetry,
  runDependencyAudits,
} from './dependency-audit-core.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, '..');
const auditCli = path.join(scriptsDirectory, 'run-dependency-audit.mjs');

const color = (code, text) =>
  `${String.fromCharCode(27)}[${code}m${text}${String.fromCharCode(27)}[39m`;

const REGISTRY_503_OUTPUT = [
  `${color(91, '>')} YN0035: Service Unavailable`,
  `${color(91, '>')} YN0035:   ${color('38;5;111', 'Response Code')}: ${color('38;5;220', '503')} (Service Unavailable)`,
  `${color(91, '>')} Errors happened when preparing the environment required to run this command.`,
].join('\n');

const PLAIN_REGISTRY_503_OUTPUT = 'YN0035:   Response Code: 503 (Service Unavailable)';

const ADVISORY_OUTPUT = [
  'YN0084: https://github.com/advisories/GHSA-0000-0000-0000 (moderate)',
  'YN0000: Found 1 vulnerability',
].join('\n');

test('classifies registry outages as unavailable and a real advisory report as not', () => {
  assert.equal(isRegistryUnavailableFailure(REGISTRY_503_OUTPUT), true);
  assert.equal(
    isRegistryUnavailableFailure(
      `${color('38;5;111', 'Response Code')}: ${color('38;5;220', '503')}`,
    ),
    true,
  );
  assert.equal(
    isRegistryUnavailableFailure("YN0001: RequestError: Timeout awaiting 'socket' for 60000ms"),
    true,
  );
  assert.equal(isRegistryUnavailableFailure('connect ETIMEDOUT 1.2.3.4:443'), true);
  assert.equal(isRegistryUnavailableFailure(ADVISORY_OUTPUT), false);
  assert.equal(isRegistryUnavailableFailure(''), false);
});

test('retries a registry outage with growing backoff and succeeds once the registry recovers', async () => {
  const delays = [];
  const codes = [1, 1, 0];
  let calls = 0;

  const result = await runAuditWithRetry({
    runAudit: () => {
      const code = codes[calls];
      calls += 1;
      return { code, output: code === 0 ? '' : REGISTRY_503_OUTPUT };
    },
    retryDelayMs: 10,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.deepEqual(result, { code: 0, output: '', attempts: 3 });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('fails immediately on a real advisory instead of retrying', async () => {
  let calls = 0;

  const result = await runAuditWithRetry({
    runAudit: () => {
      calls += 1;
      return { code: 1, output: ADVISORY_OUTPUT };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(result.code, 1);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test('reports an exhausted registry outage as unavailable rather than an advisory failure', async () => {
  let calls = 0;

  const result = await runAuditWithRetry({
    runAudit: () => {
      calls += 1;
      return { code: 1, output: REGISTRY_503_OUTPUT };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(result.code, 1);
  assert.equal(result.attempts, 3);
  assert.equal(result.registryUnavailable, true);
  assert.equal(calls, 3);
});

test('audits every directory in order and reports which directory failed', async () => {
  const audited = [];

  const passing = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) => {
      audited.push(directory);
      return { code: 0, output: '' };
    },
    sleep: async () => {},
  });

  assert.deepEqual(passing, { code: 0, registryUnavailableDirectories: [] });
  assert.deepEqual(audited, ['.', 'server', 'client']);

  const failing = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) =>
      directory === 'server' ? { code: 1, output: ADVISORY_OUTPUT } : { code: 0, output: '' },
    sleep: async () => {},
  });

  assert.equal(failing.code, 1);
  assert.equal(failing.directory, 'server');
});

test('keeps auditing the remaining workspaces when one cannot reach the registry', async () => {
  const audited = [];

  const inconclusive = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) => {
      audited.push(directory);
      return directory === 'server'
        ? { code: 1, output: REGISTRY_503_OUTPUT }
        : { code: 0, output: '' };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.deepEqual(inconclusive, { code: 0, registryUnavailableDirectories: ['server'] });
  assert.deepEqual(audited, ['.', 'server', 'server', 'server', 'client']);
});

test('still fails on a real advisory found after an unreachable workspace', async () => {
  const failing = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) => {
      if (directory === '.') {
        return { code: 1, output: REGISTRY_503_OUTPUT };
      }
      return directory === 'client'
        ? { code: 1, output: ADVISORY_OUTPUT }
        : { code: 0, output: '' };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(failing.code, 1);
  assert.equal(failing.directory, 'client');
  assert.deepEqual(failing.registryUnavailableDirectories, ['.']);
});

const fakeYarnScript = (failureBody) => `#!/bin/sh
calls=$(cat "$FAKE_YARN_CALL_FILE" 2>/dev/null || echo 0)
calls=$((calls + 1))
printf '%s' "$calls" > "$FAKE_YARN_CALL_FILE"
${failureBody}
echo "fake yarn ran: $*"
exit 0
`;

const createFakeYarn = async (failureBody) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ylabs-fake-yarn-'));
  const callFile = path.join(directory, 'calls');
  await writeFile(path.join(directory, 'yarn'), fakeYarnScript(failureBody), { mode: 0o755 });
  return { directory, callFile };
};

const runAuditCli = (cliArgs, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [auditCli, ...cliArgs], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

const withFakeYarn = (fakeYarn) => ({
  PATH: `${fakeYarn.directory}${path.delimiter}${process.env.PATH}`,
  FAKE_YARN_CALL_FILE: fakeYarn.callFile,
  DEPENDENCY_AUDIT_RETRY_DELAY_MS: '0',
});

test('the audit command exits zero when a transient registry outage clears on retry', async () => {
  const fakeYarn = await createFakeYarn(`if [ "$calls" -lt 3 ]; then
  echo '${PLAIN_REGISTRY_503_OUTPUT}' >&2
  exit 1
fi`);

  const result = await runAuditCli(
    ['.', '--', '--recursive', '--severity', 'moderate'],
    withFakeYarn(fakeYarn),
  );

  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(fakeYarn.callFile, 'utf8'), '3');
  assert.match(result.output, /npm audit --recursive --severity moderate/);
});

test('the audit command exits zero when the registry never becomes reachable', async () => {
  const fakeYarn = await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);

  const result = await runAuditCli(
    ['.', 'server', '--', '--severity', 'moderate'],
    withFakeYarn(fakeYarn),
  );

  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(fakeYarn.callFile, 'utf8'), '6');
  assert.match(result.output, /Dependency audit inconclusive for \., server/);
});

test('the audit command exits non-zero once for a real advisory and does not retry', async () => {
  const fakeYarn = await createFakeYarn(`echo '${ADVISORY_OUTPUT.split('\n')[1]}' >&2
exit 1`);

  const result = await runAuditCli(
    ['.', 'server', '--', '--severity', 'moderate'],
    withFakeYarn(fakeYarn),
  );

  assert.equal(result.code, 1);
  assert.equal(await readFile(fakeYarn.callFile, 'utf8'), '1');
  assert.match(result.output, /Dependency audit failed in \. after 1 attempt/);
});
