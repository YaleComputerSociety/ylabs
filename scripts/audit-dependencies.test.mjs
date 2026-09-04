import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditedWorkspaceDirectories,
  auditWorkspaces,
  isRegistryUnavailableFailure,
  registryRetryDelayMs,
} from './dependency-audit-core.mjs';

const registryTimeoutOutput = [
  "➤ YN0001: RequestError: Timeout awaiting 'socket' for 60000ms",
  '➤ Errors happened when preparing the environment required to run this command.',
  '➤ This might be caused by packages being missing from the lockfile, in which case running "yarn install" might help.',
].join('\n');

const advisoryOutput = [
  '➤ YN0000: ┌ example-package',
  '➤ YN0000: │ ID: 1234567',
  '➤ YN0000: │ Severity: high',
  '➤ YN0000: └ Recommendation: Upgrade to >=2.0.0',
].join('\n');

const recordingHarness = (results) => {
  const audits = [];
  const waits = [];
  const remaining = new Map(Object.entries(results));

  return {
    audits,
    waits,
    runAudit: ({ directory, attempt }) => {
      audits.push({ directory, attempt });
      const queue = remaining.get(directory) ?? [];
      return queue.shift() ?? { exitCode: 0, output: '➤ YN0000: No audit suggestions' };
    },
    waitBeforeRetry: (delayMs, context) => {
      waits.push({ delayMs, ...context });
      return Promise.resolve();
    },
  };
};

test('audits every workspace once when the registry answers cleanly', async () => {
  const harness = recordingHarness({});

  const outcome = await auditWorkspaces(harness);

  assert.equal(outcome.ok, true);
  assert.deepEqual(
    harness.audits.map(({ directory, attempt }) => `${directory}#${attempt}`),
    ['.#1', 'server#1', 'client#1'],
  );
  assert.deepEqual(harness.waits, []);
  assert.deepEqual(auditedWorkspaceDirectories, ['.', 'server', 'client']);
});

test('retries a workspace whose audit request never reached the registry', async () => {
  const harness = recordingHarness({
    server: [
      { exitCode: 1, output: registryTimeoutOutput },
      { exitCode: 0, output: '➤ YN0000: No audit suggestions' },
    ],
  });

  const outcome = await auditWorkspaces(harness);

  assert.equal(outcome.ok, true);
  assert.deepEqual(
    harness.audits.map(({ directory, attempt }) => `${directory}#${attempt}`),
    ['.#1', 'server#1', 'server#2', 'client#1'],
  );
  assert.deepEqual(harness.waits, [
    { delayMs: registryRetryDelayMs(1), directory: 'server', attempt: 1 },
  ]);
});

test('fails closed when the registry stays unreachable across every attempt', async () => {
  const harness = recordingHarness({
    '.': [
      { exitCode: 1, output: registryTimeoutOutput },
      { exitCode: 1, output: registryTimeoutOutput },
      { exitCode: 1, output: registryTimeoutOutput },
    ],
  });

  const outcome = await auditWorkspaces(harness);

  assert.deepEqual(
    {
      ok: outcome.ok,
      reason: outcome.reason,
      directory: outcome.directory,
      exitCode: outcome.exitCode,
    },
    { ok: false, reason: 'registry-unavailable', directory: '.', exitCode: 1 },
  );
  assert.deepEqual(
    harness.audits.map(({ directory, attempt }) => `${directory}#${attempt}`),
    ['.#1', '.#2', '.#3'],
  );
  assert.deepEqual(
    harness.waits.map(({ delayMs }) => delayMs),
    [registryRetryDelayMs(1), registryRetryDelayMs(2)],
  );
});

test('reported advisories fail immediately without a retry or a later workspace audit', async () => {
  const harness = recordingHarness({
    server: [{ exitCode: 1, output: advisoryOutput }],
  });

  const outcome = await auditWorkspaces(harness);

  assert.deepEqual(
    {
      ok: outcome.ok,
      reason: outcome.reason,
      directory: outcome.directory,
      exitCode: outcome.exitCode,
    },
    { ok: false, reason: 'advisories', directory: 'server', exitCode: 1 },
  );
  assert.deepEqual(
    harness.audits.map(({ directory, attempt }) => `${directory}#${attempt}`),
    ['.#1', 'server#1'],
  );
  assert.deepEqual(harness.waits, []);
});

test('registry-unavailable classification ignores successful and advisory-bearing runs', () => {
  assert.equal(isRegistryUnavailableFailure({ exitCode: 1, output: registryTimeoutOutput }), true);
  assert.equal(isRegistryUnavailableFailure({ exitCode: 1, output: advisoryOutput }), false);
  assert.equal(isRegistryUnavailableFailure({ exitCode: 0, output: registryTimeoutOutput }), false);
});

test('retry delays grow with each attempt', () => {
  assert.ok(registryRetryDelayMs(2) > registryRetryDelayMs(1));
  assert.ok(registryRetryDelayMs(1) >= 1000);
});
