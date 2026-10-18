import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(repoRoot, 'deploy', 'sweep-runner', 'entrypoint.sh');
const BETA_SHA = 'a'.repeat(40);

function sandbox({ betaSha = BETA_SHA } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-sweep-entrypoint-'));
  const bin = path.join(root, 'bin');
  const appDir = path.join(root, 'app');
  const log = path.join(root, 'calls.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(appDir, 'server', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'server', 'package.json'), '{}\n');
  fs.writeFileSync(path.join(appDir, 'server', 'yarn.lock'), 'lock\n');
  const stub = (name, body) => {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  };
  stub(
    'git',
    `echo "git $*" >> "$STUB_LOG"
case "$1" in
  ls-remote) [ -n "$STUB_BETA_SHA" ] && printf '%s\\trefs/heads/beta\\n' "$STUB_BETA_SHA"; exit 0 ;;
  clone) dest="\${@: -1}"; mkdir -p "$dest/server"; printf '{}\\n' > "$dest/server/package.json"; printf 'lock\\n' > "$dest/server/yarn.lock"; exit 0 ;;
esac
exit 0`,
  );
  stub(
    'yarn',
    `echo "yarn $* | pwd=$PWD SEARCH_INDEX_WRITES=\${SEARCH_INDEX_WRITES-unset} SWEEP_TARGET_SHA=\${SWEEP_TARGET_SHA-unset} MEILISEARCH_HOST=\${MEILISEARCH_HOST-unset}" >> "$STUB_LOG"`,
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_LOG: log,
    STUB_BETA_SHA: betaSha,
    SWEEP_RUNNER_APP_DIR: appDir,
    MEILISEARCH_HOST: 'http://127.0.0.1:7700',
    TMPDIR: root,
  };
  delete env.SEARCH_INDEX_WRITES;
  delete env.SWEEP_TARGET_SHA;
  return { root, appDir, env, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}

const runEntrypoint = (box, ...args) =>
  spawnSync('bash', [entrypoint, ...args], { encoding: 'utf8', env: box.env });

const yarnCalls = (box) =>
  box
    .calls()
    .split('\n')
    .filter((line) => line.startsWith('yarn '));

test('the default mode clones beta HEAD and runs the weekly sweep with its arguments', () => {
  const box = sandbox();
  const result = runEntrypoint(box, '--confirm-weekly-development-sweep');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[weekly-sweep\] resolved beta HEAD to a{40}/);
  assert.match(box.calls(), new RegExp(`git -C \\S+ checkout --quiet --detach ${BETA_SHA}`));
  const [install, sweep] = yarnCalls(box);
  assert.match(install, /^yarn --cwd \S+\/ylabs\/server install --immutable/);
  assert.match(
    sweep,
    new RegExp(
      `^yarn --cwd server scrape:sweep:weekly-development --confirm-weekly-development-sweep \\| pwd=\\S+/ylabs SEARCH_INDEX_WRITES=deferred SWEEP_TARGET_SHA=${BETA_SHA} MEILISEARCH_HOST=unset$`,
    ),
  );
});

test('--rerun-source runs the rerun script at the same commit with the source names', () => {
  const box = sandbox();
  const result = runEntrypoint(box, '--rerun-source', 'nih-reporter', 'doe-osti', '--override-hold');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[sweep-rerun\] resolved beta HEAD to a{40}/);
  const calls = yarnCalls(box);
  assert.equal(calls.length, 2);
  assert.match(
    calls[1],
    new RegExp(
      `^yarn --cwd server scrape:sweep:rerun-source nih-reporter doe-osti --override-hold \\| pwd=\\S+/ylabs SEARCH_INDEX_WRITES=deferred SWEEP_TARGET_SHA=${BETA_SHA} MEILISEARCH_HOST=unset$`,
    ),
  );
});

test('--rerun-source with no source refuses before cloning anything', () => {
  const box = sandbox();
  const result = runEntrypoint(box, '--rerun-source');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[sweep-rerun\] REFUSING TO START: --rerun-source needs at least one source name/);
  assert.equal(box.calls(), '');
});

test('a rerun refuses to start when beta HEAD cannot be resolved', () => {
  const box = sandbox({ betaSha: '' });
  const result = runEntrypoint(box, '--rerun-source', 'nih-reporter');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[sweep-rerun\] REFUSING TO START: could not resolve beta HEAD/);
  assert.deepEqual(yarnCalls(box), []);
});

test('--probe-hosts still runs the probe from the image without cloning', () => {
  const box = sandbox();
  const result = runEntrypoint(box, '--probe-hosts', '--host=example.yale.edu');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(box.calls(), /^git /m);
  const [probe] = yarnCalls(box);
  assert.equal(
    probe.split(' | ')[0],
    'yarn --cwd server scrape:probe-hosts --host=example.yale.edu',
  );
  assert.match(probe, new RegExp(`pwd=${box.appDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `));
});
