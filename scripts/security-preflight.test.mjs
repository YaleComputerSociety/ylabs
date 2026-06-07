import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ciWorkflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('root package exposes a deploy security preflight', () => {
  assert.equal(packageJson.scripts['security:preflight'], 'yarn security:secrets && yarn security:audit:production');
});

test('production dependency audit covers root, server, and client workspaces', () => {
  assert.equal(
    packageJson.scripts['security:audit:production'],
    [
      'yarn npm audit --severity moderate --environment production',
      'yarn --cwd server npm audit --severity moderate --environment production',
      'yarn --cwd client npm audit --severity moderate --environment production',
    ].join(' && '),
  );
});

test('CI runs the same deploy security preflight used locally', () => {
  assert.match(ciWorkflow, /name:\s*Run deploy security preflight/);
  assert.match(ciWorkflow, /run:\s*yarn security:preflight/);
});
