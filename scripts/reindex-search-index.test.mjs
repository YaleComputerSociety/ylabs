import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_REINDEX_ENV_VARS,
  describeMissingEnvVars,
  missingReindexEnvVars,
  parseReindexArgs,
  reindexCommand,
  summarizeReindexPlan,
} from './reindex-search-index-core.mjs';

const fullEnv = {
  MONGODBURL: 'mongodb+srv://user:pass@cluster0.example.net/ylabs_beta',
  MEILISEARCH_HOST: 'https://meili.example.net',
  MEILISEARCH_API_KEY: 'supersecretkey',
  MEILISEARCH_INDEX_PREFIX: 'beta_',
};

test('dry run is the default and --apply is the only way to change anything', () => {
  assert.equal(parseReindexArgs(['beta']).apply, false);
  assert.equal(parseReindexArgs(['beta', '--dry-run']).apply, false);
  assert.equal(parseReindexArgs(['beta', '--apply']).apply, true);
  assert.deepEqual(reindexCommand({ apply: false }).args, ['--cwd', 'server', 'reindex:meili']);
  assert.deepEqual(reindexCommand({ apply: true }).args, [
    '--cwd',
    'server',
    'reindex:meili',
    '--confirm',
  ]);
});

test('only beta and production are accepted, and dev is redirected rather than rejected blankly', () => {
  assert.equal(parseReindexArgs(['beta']).environment, 'beta');
  assert.equal(parseReindexArgs(['production']).environment, 'production');
  for (const bad of ['development', 'dev', 'staging', 'BETA']) {
    assert.throws(() => parseReindexArgs([bad]), /Unsupported environment/);
  }
  // A reader who typed the wrong environment should be told the right command,
  // not just refused.
  assert.throws(() => parseReindexArgs(['development']), /development:search:rebuild/);
});

test('argument shape is enforced', () => {
  assert.throws(() => parseReindexArgs([]), /Exactly one environment/);
  assert.throws(() => parseReindexArgs(['beta', 'production']), /Exactly one environment/);
  assert.throws(() => parseReindexArgs(['beta', '--confirm']), /Unknown argument/);
});

test('every missing environment variable is reported at once, with its expected shape', () => {
  assert.deepEqual(missingReindexEnvVars(fullEnv), []);

  const missing = missingReindexEnvVars({});
  assert.equal(missing.length, REQUIRED_REINDEX_ENV_VARS.length);

  // Reporting one per run would mean four failed runs to discover four gaps,
  // which is the specific friction this wrapper exists to remove.
  const described = describeMissingEnvVars(missing);
  for (const { name } of REQUIRED_REINDEX_ENV_VARS) {
    assert.match(described, new RegExp(name));
  }
  assert.match(described, /expected:/);
  assert.match(described, /why:/);

  // Whitespace is not a value.
  assert.equal(missingReindexEnvVars({ ...fullEnv, MEILISEARCH_INDEX_PREFIX: '   ' }).length, 1);
});

test('the plan never echoes credentials', () => {
  const plan = summarizeReindexPlan({ environment: 'beta', apply: true, env: fullEnv });

  // An operator may be sharing a terminal or pasting output into a ticket.
  assert.doesNotMatch(plan, /user:pass/);
  assert.doesNotMatch(plan, /supersecretkey/);
  assert.match(plan, /meili api key:\s+present/);

  // But it must still show enough to abort on: host, prefix, and which database.
  assert.match(plan, /cluster0\.example\.net/);
  assert.match(plan, /database=ylabs_beta/);
  assert.match(plan, /index prefix:\s+beta_/);
  assert.match(plan, /APPLY/);
});

test('the plan names dry run explicitly so a reader cannot mistake the mode', () => {
  const plan = summarizeReindexPlan({ environment: 'production', apply: false, env: fullEnv });
  assert.match(plan, /DRY RUN - reports only, changes nothing/);
  assert.doesNotMatch(plan, /APPLY/);
});

test('an unparseable Mongo URL is surfaced, not silently blanked', () => {
  const plan = summarizeReindexPlan({
    environment: 'beta',
    apply: false,
    env: { ...fullEnv, MONGODBURL: 'not-a-url' },
  });
  assert.match(plan, /not a parseable URL/);
  assert.doesNotMatch(plan, /not-a-url/);
});
