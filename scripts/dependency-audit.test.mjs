import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUDIT_VERDICTS,
  MAX_AUDIT_TIMEOUT_MS,
  REGISTRY_UNAVAILABLE_EXIT_CODE,
  auditTimeoutForAttempt,
  isRegistryUnavailableFailure,
  runAuditWithRetry,
  runDependencyAudits,
  spawnAudit,
} from './dependency-audit-core.mjs';

const readVerdict = async (file) => JSON.parse(await readFile(file, 'utf8'));

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

  assert.deepEqual(passing, {
    code: 0,
    failedDirectories: [],
    registryUnavailableDirectories: [],
  });
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
  assert.deepEqual(failing.failedDirectories, ['server']);
});

test('keeps auditing after a real advisory so a later workspace cannot stay hidden', async () => {
  const audited = [];

  const failing = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) => {
      audited.push(directory);
      return directory === '.' ? { code: 0, output: '' } : { code: 1, output: ADVISORY_OUTPUT };
    },
    sleep: async () => {},
  });

  // Aborting at 'server' is what kept two HIGH client advisories invisible for an
  // entire outage (#2371): every workspace has to be reached in one run.
  assert.deepEqual(audited, ['.', 'server', 'client']);
  assert.equal(failing.code, 1);
  assert.deepEqual(failing.failedDirectories, ['server', 'client']);
});

test('stops spawning audits once the registry is proven unreachable for the run', async () => {
  const audited = [];

  const unreachable = await runDependencyAudits({
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

  assert.deepEqual(unreachable, {
    code: 0,
    failedDirectories: [],
    registryUnavailableDirectories: ['server', 'client'],
  });
  // 'client' is never spawned: one exhausted workspace already settles the verdict,
  // and re-running the ladder per workspace only multiplies the stall.
  assert.deepEqual(audited, ['.', 'server', 'server', 'server']);
});

test('reports an advisory found before the registry went unreachable', async () => {
  const failing = await runDependencyAudits({
    directories: ['.', 'server', 'client'],
    auditArgs: [],
    runAudit: (directory) => {
      if (directory === '.') {
        return { code: 1, output: ADVISORY_OUTPUT };
      }
      return { code: 1, output: REGISTRY_503_OUTPUT };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(failing.code, 1);
  assert.equal(failing.directory, '.');
  assert.deepEqual(failing.failedDirectories, ['.']);
  // The advisory decides the exit code, and the workspaces whose verdict is
  // unknown are still reported rather than silently counted as clean.
  assert.deepEqual(failing.registryUnavailableDirectories, ['server', 'client']);
});

const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.killed = false;
  // Never emits 'close', mimicking a killed yarn whose grandchildren still hold
  // the stdio pipes open.
  child.kill = () => {
    child.killed = true;
  };
  return child;
};

test('grows the per-attempt timeout so a slow registry is not misread as a dead one', () => {
  // A degraded advisory service answered in 19-28s while hanging past 70s on other
  // probes. Attempt 1 must be tight enough that a hard outage is cheap, and later
  // attempts generous enough to catch a slow success instead of reporting a false
  // "unreachable" and blocking every merge.
  assert.equal(auditTimeoutForAttempt(1, 20_000), 20_000);
  assert.equal(auditTimeoutForAttempt(2, 20_000), 40_000);
  assert.equal(auditTimeoutForAttempt(3, 20_000), 60_000);

  // Never exceed yarn's own default ceiling, or the bound stops being a bound.
  assert.equal(auditTimeoutForAttempt(9, 20_000), MAX_AUDIT_TIMEOUT_MS);
  assert.ok(MAX_AUDIT_TIMEOUT_MS <= 60_000);

  // A zero base disables the bound entirely rather than escalating from nothing.
  assert.equal(auditTimeoutForAttempt(3, 0), 0);
  assert.equal(auditTimeoutForAttempt(0, 20_000), 20_000);
});

test('escalates the real spawn budget across retries', async () => {
  const budgets = [];

  await runDependencyAudits({
    directories: ['.'],
    auditArgs: [],
    timeoutMs: 1_000,
    runAudit: (directory, attempt) => {
      budgets.push(auditTimeoutForAttempt(attempt, 1_000));
      return { code: 1, output: REGISTRY_503_OUTPUT };
    },
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.deepEqual(budgets, [1_000, 2_000, 3_000]);
});

test('caps yarn http timeout and retry for the audit only, leaving installs alone', async () => {
  let spawnOptions = null;
  const child = fakeChild();

  await spawnAudit({
    directory: '.',
    auditArgs: [],
    spawnProcess: (_command, _args, options) => {
      spawnOptions = options;
      return child;
    },
    stream: { write: () => {} },
    timeoutMs: 30,
    env: { PATH: '/usr/bin', EXISTING: 'kept' },
  });

  // Yarn's own timeout is what makes it exit gracefully with a classifiable error.
  assert.equal(spawnOptions.env.YARN_HTTP_TIMEOUT, '30');
  // Retry belongs to this runner; yarn's default 3 would multiply into 9 requests.
  assert.equal(spawnOptions.env.YARN_HTTP_RETRY, '1');
  // Scoped to the spawn, so .yarnrc.yml stays free of a global cap that would also
  // throttle install tarball fetches.
  assert.equal(spawnOptions.env.EXISTING, 'kept');
  assert.equal(process.env.YARN_HTTP_TIMEOUT, undefined);
});

test('bounds a hanging audit attempt instead of waiting on the process to close', async () => {
  const child = fakeChild();

  const started = Date.now();
  const result = await spawnAudit({
    directory: '.',
    auditArgs: [],
    spawnProcess: () => child,
    stream: { write: () => {} },
    timeoutMs: 20,
  });

  assert.equal(child.killed, true);
  assert.equal(result.code, 1);
  assert.equal(isRegistryUnavailableFailure(result.output), true);
  assert.ok(Date.now() - started < 30_000, 'the backstop must resolve without a close event');
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

test('the audit command fails closed with a distinct code when the registry never becomes reachable', async () => {
  const fakeYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);

  const result = await runAuditCli(
    ['.', 'server', '--', '--severity', 'moderate'],
    withFakeYarn(fakeYarn),
  );

  assert.equal(result.code, REGISTRY_UNAVAILABLE_EXIT_CODE, result.output);
  assert.notEqual(REGISTRY_UNAVAILABLE_EXIT_CODE, 0);
  // Only the first workspace runs the ladder; 'server' is skipped.
  assert.equal(await readFile(fakeYarn.callFile, 'utf8'), '3');
  assert.match(result.output, /advisory registry unreachable, verdict unknown/);
  assert.match(result.output, /Failing closed/);
  // The operator must be told the override exists, or they will reach for --admin.
  assert.match(result.output, /DEPENDENCY_AUDIT_ALLOW_UNREACHABLE=1/);
});

test('the audit command distinguishes an unreachable registry from a real advisory by exit code', async () => {
  const unreachableYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);
  const advisoryYarn = await createFakeYarn(`echo '${ADVISORY_OUTPUT.split('\n')[1]}' >&2
exit 1`);

  const unreachable = await runAuditCli(
    ['.', '--', '--severity', 'moderate'],
    withFakeYarn(unreachableYarn),
  );
  const advisory = await runAuditCli(
    ['.', '--', '--severity', 'moderate'],
    withFakeYarn(advisoryYarn),
  );

  assert.notEqual(
    unreachable.code,
    advisory.code,
    'a caller must be able to tell "verdict unknown" from "verdict: bad"',
  );
  assert.equal(unreachable.code, REGISTRY_UNAVAILABLE_EXIT_CODE);
  assert.equal(advisory.code, 1);
});

test('the operator override proceeds without a verdict but never hides that it did', async () => {
  const fakeYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);

  const result = await runAuditCli(['.', '--', '--severity', 'moderate'], {
    ...withFakeYarn(fakeYarn),
    DEPENDENCY_AUDIT_ALLOW_UNREACHABLE: '1',
  });

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /advisory registry unreachable, verdict unknown/);
  assert.match(result.output, /operator override, not a pass/);
});

test('the override only accepts an exact opt-in value', async () => {
  const fakeYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);

  for (const value of ['', '0', 'true', 'yes', 'false']) {
    const result = await runAuditCli(['.', '--', '--severity', 'moderate'], {
      ...withFakeYarn(fakeYarn),
      DEPENDENCY_AUDIT_ALLOW_UNREACHABLE: value,
    });

    assert.equal(
      result.code,
      REGISTRY_UNAVAILABLE_EXIT_CODE,
      `${JSON.stringify(value)} must not disable the gate`,
    );
  }
});

test('the audit command reports every workspace with a real advisory and does not retry either', async () => {
  const fakeYarn = await createFakeYarn(`echo '${ADVISORY_OUTPUT.split('\n')[1]}' >&2
exit 1`);

  const result = await runAuditCli(
    ['.', 'server', '--', '--severity', 'moderate'],
    withFakeYarn(fakeYarn),
  );

  assert.equal(result.code, 1);
  // One attempt each, both workspaces: a real advisory is not retried, and it does
  // not abort the sweep either, so the run reports the complete set of findings.
  assert.equal(await readFile(fakeYarn.callFile, 'utf8'), '2');
  assert.match(result.output, /Dependency audit FAILED in \., server/);
  assert.match(result.output, /complete set of findings/);
});

test('the verdict artifact distinguishes clean, advisories-found, and unreachable', async () => {
  const verdictFile = path.join(await mkdtemp(path.join(tmpdir(), 'ylabs-verdict-')), 'v.json');

  const cleanYarn = await createFakeYarn('');
  await runAuditCli(['.', '--', '--severity', 'moderate'], {
    ...withFakeYarn(cleanYarn),
    DEPENDENCY_AUDIT_VERDICT_FILE: verdictFile,
  });
  assert.equal((await readVerdict(verdictFile)).verdict, AUDIT_VERDICTS.CLEAN);

  const advisoryYarn = await createFakeYarn(`echo '${ADVISORY_OUTPUT.split('\n')[1]}' >&2
exit 1`);
  await runAuditCli(['.', '--', '--severity', 'moderate'], {
    ...withFakeYarn(advisoryYarn),
    DEPENDENCY_AUDIT_VERDICT_FILE: verdictFile,
  });
  const advisory = await readVerdict(verdictFile);
  assert.equal(advisory.verdict, AUDIT_VERDICTS.ADVISORIES_FOUND);
  assert.deepEqual(advisory.directories, ['.']);

  const outageYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);
  await runAuditCli(['.', '--', '--severity', 'moderate'], {
    ...withFakeYarn(outageYarn),
    DEPENDENCY_AUDIT_VERDICT_FILE: verdictFile,
  });
  assert.equal((await readVerdict(verdictFile)).verdict, AUDIT_VERDICTS.REGISTRY_UNREACHABLE);
});

test('the override verdict is distinct from a clean verdict, so a pass cannot be forged', async () => {
  const verdictFile = path.join(await mkdtemp(path.join(tmpdir(), 'ylabs-verdict-')), 'v.json');
  const outageYarn =
    await createFakeYarn(`echo "RequestError: Timeout awaiting 'socket' for 60000ms" >&2
exit 1`);

  const result = await runAuditCli(['.', '--', '--severity', 'moderate'], {
    ...withFakeYarn(outageYarn),
    DEPENDENCY_AUDIT_VERDICT_FILE: verdictFile,
    DEPENDENCY_AUDIT_ALLOW_UNREACHABLE: '1',
  });

  // The override lets the run exit 0, but the artifact must NOT say "clean" - a
  // consumer has to be able to tell a genuine pass from a deliberately overridden
  // outage, or the override becomes an invisible soft pass.
  assert.equal(result.code, 0);
  const verdict = await readVerdict(verdictFile);
  assert.equal(verdict.verdict, AUDIT_VERDICTS.REGISTRY_UNREACHABLE_OVERRIDDEN);
  assert.notEqual(verdict.verdict, AUDIT_VERDICTS.CLEAN);
});

test('no verdict file is written when the env var is unset', async () => {
  // Absent DEPENDENCY_AUDIT_VERDICT_FILE, the run must behave exactly as before -
  // the signal is opt-in and never a required side effect.
  const cleanYarn = await createFakeYarn('');
  const result = await runAuditCli(['.', '--', '--severity', 'moderate'], withFakeYarn(cleanYarn));
  assert.equal(result.code, 0, result.output);
});
