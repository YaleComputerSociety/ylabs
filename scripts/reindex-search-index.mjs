#!/usr/bin/env node
import { spawn } from 'node:child_process';

import {
  describeMissingEnvVars,
  missingReindexEnvVars,
  parseReindexArgs,
  reindexCommand,
  summarizeReindexPlan,
} from './reindex-search-index-core.mjs';

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

let options;
try {
  options = parseReindexArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const env = { ...process.env, SCRAPER_ENV: options.environment };

const missing = missingReindexEnvVars(env);
if (missing.length > 0) {
  fail(describeMissingEnvVars(missing));
}

console.log(summarizeReindexPlan({ ...options, env }));

if (options.apply) {
  console.log('  Applying in 5 seconds. Ctrl-C now to abort.\n');
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

const { command, args } = reindexCommand(options);
const child = spawn(command, args, { stdio: 'inherit', shell: false, env });

child.on('error', (error) => {
  // Sanitized: an exec failure can carry the resolved path and environment.
  console.error(
    `Failed to start ${command}: ${error instanceof Error ? error.message : 'unknown'}`,
  );
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(
      options.apply
        ? '\nReindex complete. Run the verification queries in docs/meilisearch-reindex-runbook.md before reindexing the next environment.'
        : '\nDry run complete. Nothing changed. Re-run with --apply to clear and rebuild.',
    );
  } else {
    console.error(
      `\nreindex:meili exited ${code}. Nothing was rebuilt unless the output above says otherwise. The four preconditions it enforces are listed in docs/meilisearch-reindex-runbook.md.`,
    );
  }
  process.exit(code ?? 1);
});
