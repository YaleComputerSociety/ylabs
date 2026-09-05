// Operator-facing preflight for the Beta and Production Meilisearch reindex.
//
// This deliberately does NOT re-implement any guard. `reindex:meili`
// (server/src/scripts/reindexMeiliForEnvironment.ts) already fails closed on the
// environment, an empty MEILISEARCH_HOST, an empty MEILISEARCH_INDEX_PREFIX, a
// Mongo target that disagrees with SCRAPER_ENV, and a database with zero
// non-archived entities. Duplicating those checks here would create a second
// source of truth that can drift from the one that actually protects the index.
//
// What it adds is the thing a human on a server needs and the underlying script
// cannot give them: every missing environment variable reported at once, with the
// shape each value should take, instead of discovering them one thrown error per
// run.

export const REINDEX_ENVIRONMENTS = Object.freeze(['beta', 'production']);

export const REQUIRED_REINDEX_ENV_VARS = Object.freeze([
  {
    name: 'MONGODBURL',
    example: 'mongodb+srv://<user>:<password>@<cluster>/<database>',
    why: 'The database the index is rebuilt FROM. reindex:meili cross-checks it against SCRAPER_ENV and refuses a mismatch.',
  },
  {
    name: 'MEILISEARCH_HOST',
    example: 'https://<your-meilisearch-host>',
    why: 'The Meilisearch instance to rebuild. Must not be empty, or the rebuild would target localhost.',
  },
  {
    name: 'MEILISEARCH_API_KEY',
    example: '<the master or admin key for that instance>',
    why: 'Write access to the instance. Without it the rebuild fails partway, after clearing.',
  },
  {
    name: 'MEILISEARCH_INDEX_PREFIX',
    example: 'beta_  (production uses its own distinct prefix)',
    why: 'Namespaces the indexes. reindex:meili refuses an empty prefix so a remote rebuild cannot clobber the unprefixed local index.',
  },
]);

export function parseReindexArgs(argv) {
  const positional = [];
  let apply = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      // Accepted for symmetry, but it is already the default. Being explicit is
      // free and makes a runbook copy-paste read unambiguously.
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(
        `Unknown argument: ${arg}. Usage: reindex-search-index.mjs <beta|production> [--apply]`,
      );
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error(
      'Exactly one environment is required. Usage: reindex-search-index.mjs <beta|production> [--apply]',
    );
  }

  const environment = positional[0];
  if (!REINDEX_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `Unsupported environment "${environment}". Supported: ${REINDEX_ENVIRONMENTS.join(', ')}. The local index is rebuilt with "yarn development:search:rebuild" instead.`,
    );
  }

  return { environment, apply };
}

export function missingReindexEnvVars(env) {
  return REQUIRED_REINDEX_ENV_VARS.filter(({ name }) => !String(env[name] || '').trim());
}

export function describeMissingEnvVars(missing) {
  const lines = [
    `Missing ${missing.length} required environment variable(s). Set all of them, then re-run:`,
    '',
  ];
  for (const { name, example, why } of missing) {
    lines.push(`  ${name}`);
    lines.push(`    expected: ${example}`);
    lines.push(`    why:      ${why}`);
    lines.push('');
  }
  lines.push('Values come from the Render dashboard for the target service.');
  lines.push('Do not paste them into a shared shell history or a committed file.');
  return lines.join('\n');
}

// Only the host is shown, never credentials. MONGODBURL carries a password and
// MEILISEARCH_API_KEY is a secret, so the plan reports whether each is present
// rather than echoing it: an operator running this on a server may be sharing a
// terminal or a screenshot.
export function summarizeReindexPlan({ environment, apply, env }) {
  const meiliHost = String(env.MEILISEARCH_HOST || '').trim();
  const indexPrefix = String(env.MEILISEARCH_INDEX_PREFIX || '').trim();
  const mongoUrl = String(env.MONGODBURL || '').trim();
  let mongoTarget = '(unset)';
  if (mongoUrl) {
    try {
      const parsed = new URL(mongoUrl);
      const database = parsed.pathname.replace(/^\//, '') || '(default)';
      mongoTarget = `${parsed.hostname} database=${database}`;
    } catch {
      mongoTarget = '(set, but not a parseable URL - reindex:meili will validate it)';
    }
  }

  return [
    'Meilisearch reindex plan',
    '',
    `  environment:    ${environment}`,
    `  mode:           ${apply ? 'APPLY - will clear and rebuild the index' : 'DRY RUN - reports only, changes nothing'}`,
    `  meili host:     ${meiliHost || '(unset)'}`,
    `  index prefix:   ${indexPrefix || '(unset)'}`,
    `  mongo target:   ${mongoTarget}`,
    `  meili api key:  ${String(env.MEILISEARCH_API_KEY || '').trim() ? 'present' : '(unset)'}`,
    '',
    '  reindex:meili prints the authoritative preflight next, including the live',
    '  document count, and refuses to run if that count is zero.',
    '',
  ].join('\n');
}

export function reindexCommand({ apply }) {
  const args = ['--cwd', 'server', 'reindex:meili'];
  if (apply) args.push('--confirm');
  return { command: 'yarn', args };
}
