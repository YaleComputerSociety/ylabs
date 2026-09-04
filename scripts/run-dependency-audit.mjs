#!/usr/bin/env node
import {
  DEFAULT_RETRY_DELAY_MS,
  MAX_AUDIT_ATTEMPTS,
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

const result = await runDependencyAudits({
  directories,
  auditArgs,
  attempts: numberFromEnv('DEPENDENCY_AUDIT_ATTEMPTS', MAX_AUDIT_ATTEMPTS),
  retryDelayMs: numberFromEnv('DEPENDENCY_AUDIT_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS),
  log: (message) => console.error(message),
});

if (result.code !== 0) {
  console.error(
    `Dependency audit failed in ${result.directory} after ${result.attempts} attempt(s).`,
  );
  process.exit(result.code);
}
