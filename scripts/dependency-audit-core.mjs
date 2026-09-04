import { spawn } from 'node:child_process';

export const MAX_AUDIT_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 5_000;

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

    const retryable = attempt < attempts && isRegistryUnavailableFailure(result.output);
    if (!retryable) {
      return { ...result, attempts: attempt };
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
}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('yarn', ['npm', 'audit', ...auditArgs], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const collect = (chunk) => {
      output += chunk;
      stream.write(chunk);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

export async function runDependencyAudits({
  directories,
  auditArgs,
  runAudit = (directory) => spawnAudit({ directory, auditArgs }),
  attempts = MAX_AUDIT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = wait,
  log = () => {},
}) {
  for (const directory of directories) {
    log(`Auditing dependencies in ${directory}`);
    const result = await runAuditWithRetry({
      runAudit: () => runAudit(directory),
      attempts,
      retryDelayMs,
      sleep,
      log,
    });

    if (result.code !== 0) {
      return { ...result, directory };
    }
  }

  return { code: 0 };
}
