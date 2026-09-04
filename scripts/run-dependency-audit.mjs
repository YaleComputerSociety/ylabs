#!/usr/bin/env node
import {
  DEFAULT_AUDIT_TIMEOUT_MS,
  DEFAULT_RETRY_DELAY_MS,
  MAX_AUDIT_ATTEMPTS,
  REGISTRY_UNAVAILABLE_EXIT_CODE,
  runDependencyAudits,
} from './dependency-audit-core.mjs';

const argv = process.argv.slice(2);
const separatorIndex = argv.indexOf('--');
const directories = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
const auditArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);

if (directories.length === 0) {
  console.error('Usage: run-dependency-audit.mjs <directory...> [-- <yarn npm audit args...>]');
  process.exit(2);
}

const numberFromEnv = (name, fallback) => {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const timeoutMs = numberFromEnv('DEPENDENCY_AUDIT_TIMEOUT_MS', DEFAULT_AUDIT_TIMEOUT_MS);

const result = await runDependencyAudits({
  directories,
  auditArgs,
  timeoutMs,
  attempts: numberFromEnv('DEPENDENCY_AUDIT_ATTEMPTS', MAX_AUDIT_ATTEMPTS),
  retryDelayMs: numberFromEnv('DEPENDENCY_AUDIT_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS),
  log: (message) => console.error(message),
});

if (result.code !== 0) {
  console.error(
    `Dependency audit FAILED in ${result.directory} after ${result.attempts} attempt(s): the registry answered and reported advisories at or above the requested severity.`,
  );
  process.exit(result.code);
}

if (result.registryUnavailableDirectories.length === 0) {
  process.exit(0);
}

const unreachable = result.registryUnavailableDirectories.join(', ');
console.error('');
console.error('  advisory registry unreachable, verdict unknown');
console.error('');
console.error(`  Workspaces left unaudited: ${unreachable}`);
console.error('  Nothing is wrong with your changes or the lockfile. Any yarn hint above about');
console.error('  packages "missing from the lockfile" is boilerplate for a failed network call.');
console.error('  Probe the endpoint yarn actually calls before re-running:');
console.error(
  "    curl -m 20 -o /dev/null -sw '%{http_code} %{time_total}s\\n' -X POST -H 'content-type: application/json' \\",
);
console.error(
  '      -d \'{"react":["18.0.0"]}\' https://registry.yarnpkg.com/-/npm/v1/security/advisories/bulk',
);
console.error('  status.npmjs.org reports "All Systems Operational" through these outages.');
console.error('');

if (process.env.DEPENDENCY_AUDIT_ALLOW_UNREACHABLE === '1') {
  console.error(
    '  DEPENDENCY_AUDIT_ALLOW_UNREACHABLE=1 is set: proceeding WITHOUT an advisory verdict.',
  );
  console.error('  This is an operator override, not a pass. Re-audit once the registry returns.');
  console.error('');
  process.exit(0);
}

console.error('  Failing closed. An outage window is a plausible time to publish a bad package,');
console.error('  and beta promotes to production, so "could not check" must not read as "clean".');
console.error('  To override deliberately for one run, set DEPENDENCY_AUDIT_ALLOW_UNREACHABLE=1.');
console.error('');
process.exit(REGISTRY_UNAVAILABLE_EXIT_CODE);
