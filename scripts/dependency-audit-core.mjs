export const auditedWorkspaceDirectories = ['.', 'server', 'client'];

export const maxRegistryAuditAttempts = 3;

// `yarn npm audit` posts to the registry bulk-advisory endpoint, and got does not
// retry POSTs, so a transient socket timeout there fails the gate with no verdict.
const registryUnavailableMarkers = [
  'Errors happened when preparing the environment required to run this command.',
  'RequestError',
  'Timeout awaiting',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'socket hang up',
];

export const isRegistryUnavailableFailure = ({ exitCode, output }) =>
  exitCode !== 0 && registryUnavailableMarkers.some((marker) => output.includes(marker));

export const registryRetryDelayMs = (attempt) => attempt * 5000;

export async function auditWorkspaces({
  directories = auditedWorkspaceDirectories,
  maxAttempts = maxRegistryAuditAttempts,
  runAudit,
  waitBeforeRetry,
}) {
  const attempts = [];

  for (const directory of directories) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await runAudit({ directory, attempt });
      attempts.push({ directory, attempt, exitCode: result.exitCode });

      if (result.exitCode === 0) break;

      if (!isRegistryUnavailableFailure(result)) {
        return {
          ok: false,
          attempts,
          directory,
          attempt,
          exitCode: result.exitCode,
          reason: 'advisories',
        };
      }

      if (attempt === maxAttempts) {
        return {
          ok: false,
          attempts,
          directory,
          attempt,
          exitCode: result.exitCode,
          reason: 'registry-unavailable',
        };
      }

      await waitBeforeRetry(registryRetryDelayMs(attempt), { directory, attempt });
    }
  }

  return { ok: true, attempts };
}
