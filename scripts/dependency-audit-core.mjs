import { spawn } from 'node:child_process';

export const MAX_AUDIT_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 5_000;

// Yarn defaults to httpTimeout 60s and httpRetry 3, so a single audit against a
// hard-down registry can spend three minutes before it gives up, and six
// workspace audits stall CI far longer. Both are settable, but only per
// invocation here: putting httpTimeout in .yarnrc.yml would also cap install
// tarball fetches, where a low ceiling causes flaky installs on slow networks.
export const DEFAULT_AUDIT_TIMEOUT_MS = 20_000;

// The advisory service degrades before it fails outright: on 2026-09-04 it
// answered 2 of 5 probes in 19-28s and hung past 70s on the other 3. A single
// tight timeout turns that into a false "unreachable", and a single generous one
// makes a hard outage expensive. Grow the budget per attempt instead, so a dead
// registry costs seconds on attempt 1 while a merely slow one still gets a real
// chance before the run gives up.
export const MAX_AUDIT_TIMEOUT_MS = 60_000;

export function auditTimeoutForAttempt(attempt, baseMs = DEFAULT_AUDIT_TIMEOUT_MS) {
  if (baseMs <= 0) return 0;
  return Math.min(baseMs * Math.max(1, attempt), MAX_AUDIT_TIMEOUT_MS);
}

// Yarn exits on its own at httpTimeout with a legible "Timeout awaiting 'socket'"
// error that isRegistryUnavailableFailure already classifies. The SIGKILL below is
// only a backstop for a yarn that ignores its own timeout, so it must fire later.
const KILL_GRACE_MS = 8_000;

// Retries are this runner's job, not yarn's. Left at the default of 3, yarn's
// internal retries multiply with our attempts into nine requests per workspace.
const YARN_AUDIT_HTTP_RETRY = '1';

// EX_TEMPFAIL: "we could not reach the registry", distinct from exit 1
// "the registry answered and reported advisories".
export const REGISTRY_UNAVAILABLE_EXIT_CODE = 75;

export const AUDIT_TIMEOUT_MARKER = 'ESOCKETTIMEDOUT';

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

const REGISTRY_UNAVAILABLE_PATTERNS = [
  /\bYN0035\b/,
  /\bRequestError\b/,
  /Timeout awaiting/i,
  /Response Code\s*:\s*(?:408|425|429|5\d\d)\b/,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE)\b/,
  /socket hang up/i,
  /network timeout/i,
  /request to \S+ failed/i,
];

export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_ESCAPE_PATTERN, '');
}

export function isRegistryUnavailableFailure(output) {
  const plainOutput = stripAnsi(output);
  return REGISTRY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(plainOutput));
}

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function runAuditWithRetry({
  runAudit,
  attempts = MAX_AUDIT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = wait,
  log = () => {},
}) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await runAudit(attempt);

    if (result.code === 0) {
      return { ...result, attempts: attempt };
    }

    const registryUnavailable = isRegistryUnavailableFailure(result.output);
    if (!registryUnavailable || attempt >= attempts) {
      return { ...result, attempts: attempt, registryUnavailable };
    }

    const delayMs = retryDelayMs * attempt;
    log(
      `Advisory registry was unavailable (attempt ${attempt} of ${attempts}); retrying in ${delayMs}ms.`,
    );
    await sleep(delayMs);
  }
}

export function spawnAudit({
  directory,
  auditArgs,
  spawnProcess = spawn,
  stream = process.stderr,
  timeoutMs = DEFAULT_AUDIT_TIMEOUT_MS,
  env = process.env,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('yarn', ['npm', 'audit', ...auditArgs], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...env,
        ...(timeoutMs > 0 ? { YARN_HTTP_TIMEOUT: String(timeoutMs) } : {}),
        YARN_HTTP_RETRY: YARN_AUDIT_HTTP_RETRY,
      },
    });

    let output = '';
    let settled = false;
    const collect = (chunk) => {
      output += chunk;
      stream.write(chunk);
    };

    // Backstop only: yarn should have exited at YARN_HTTP_TIMEOUT already. Resolve
    // on the timer rather than waiting for 'close', because a killed yarn can leave
    // grandchildren holding the stdio pipes open and 'close' waits for those, which
    // would reintroduce the unbounded stall this bound exists to prevent.
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            const notice = `${AUDIT_TIMEOUT_MARKER}: audit attempt in ${directory} ignored its own ${timeoutMs}ms http timeout; killing it and treating the advisory registry as unreachable.\n`;
            stream.write(notice);
            child.kill('SIGKILL');
            settle({ code: 1, output: output + notice });
          }, timeoutMs + KILL_GRACE_MS)
        : null;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => settle({ code: code ?? 1, output }));
  });
}

export async function runDependencyAudits({
  directories,
  auditArgs,
  timeoutMs = DEFAULT_AUDIT_TIMEOUT_MS,
  runAudit = (directory, attempt) =>
    spawnAudit({
      directory,
      auditArgs,
      timeoutMs: auditTimeoutForAttempt(attempt, timeoutMs),
    }),
  attempts = MAX_AUDIT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = wait,
  log = () => {},
}) {
  const registryUnavailableDirectories = [];

  for (const directory of directories) {
    // One exhausted workspace already proves the registry is down for this run.
    // Re-running the full retry ladder for every remaining workspace only
    // multiplies the stall without changing the verdict.
    if (registryUnavailableDirectories.length > 0) {
      registryUnavailableDirectories.push(directory);
      log(`Skipping ${directory}: the advisory registry is already known unreachable this run.`);
      continue;
    }

    log(`Auditing dependencies in ${directory}`);
    const result = await runAuditWithRetry({
      runAudit: (attempt) => runAudit(directory, attempt),
      attempts,
      retryDelayMs,
      sleep,
      log,
    });

    if (result.code === 0) {
      continue;
    }

    if (result.registryUnavailable) {
      registryUnavailableDirectories.push(directory);
      log(
        `Advisory registry stayed unreachable for ${directory} after ${result.attempts} attempt(s); the audit verdict for this run is unknown.`,
      );
      continue;
    }

    return { ...result, directory, registryUnavailableDirectories };
  }

  return { code: 0, registryUnavailableDirectories };
}
