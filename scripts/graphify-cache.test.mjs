import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactValidationError,
  cacheRefreshReasons,
  commitsMatch,
  hashInputs,
  isGraphInputPath,
  parseInstalledGraphifyVersion,
  parseReportSourceCommit,
} from './graphify-cache-core.mjs';

const validGraph = JSON.stringify({ nodes: [{ id: 'one' }], links: [{ source: 'one' }] });
const validReport = '## Graph Freshness\n- Built from commit: `a7a6e9c0`\n';

test('recognizes graph-relevant source and architecture files', () => {
  assert.equal(isGraphInputPath('server/src/services/userService.ts'), true);
  assert.equal(isGraphInputPath('client/src/pages/research.tsx'), true);
  assert.equal(isGraphInputPath('skills/graphify/SKILL.md'), true);
  assert.equal(isGraphInputPath('package.json'), true);
  assert.equal(isGraphInputPath('graphify-out/graph.json'), false);
  assert.equal(isGraphInputPath('server/node_modules/example/index.js'), false);
  assert.equal(isGraphInputPath('client/build/assets/index.js'), false);
});

test('parses the installed version and report source commit', () => {
  assert.equal(parseInstalledGraphifyVersion('graphify 0.9.6\n'), '0.9.6');
  assert.equal(
    parseReportSourceCommit('## Graph Freshness\n- Built from commit: `a7a6e9c0`\n'),
    'a7a6e9c0',
  );
  assert.equal(commitsMatch('a7a6e9c0592878eb', 'a7a6e9c0'), true);
  assert.equal(commitsMatch('a7a6e9c0592878eb', 'ba888018'), false);
});

test('hashes graph inputs independently of enumeration order', () => {
  const first = hashInputs([
    { path: 'b.ts', content: 'two' },
    { path: 'a.ts', content: 'one' },
  ]);
  const second = hashInputs([
    { path: 'a.ts', content: 'one' },
    { path: 'b.ts', content: 'two' },
  ]);
  assert.equal(first, second);
});

test('validates both generated graph artifacts', () => {
  assert.equal(artifactValidationError(validGraph, validReport), '');
  assert.equal(
    artifactValidationError('{', validReport),
    'graphify-out/graph.json is not valid JSON',
  );
  assert.equal(
    artifactValidationError(validGraph, '# Incomplete report\n'),
    'graphify-out/GRAPH_REPORT.md must identify its source commit',
  );
});

test('refreshes for missing, stale, version-mismatched, or changed caches', () => {
  assert.deepEqual(
    cacheRefreshReasons({
      artifactsExist: true,
      artifactsValid: true,
      expectedVersion: '0.9.6',
      installedVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      reportCommit: 'a7a6e9c0',
      inputFingerprint: 'fingerprint',
      artifactDigest: 'artifact-digest',
      state: {
        graphifyVersion: '0.9.6',
        head: 'a7a6e9c0592878eb',
        inputFingerprint: 'fingerprint',
        artifactDigest: 'artifact-digest',
      },
    }),
    [],
  );

  assert.deepEqual(
    cacheRefreshReasons({
      artifactsExist: true,
      artifactsValid: true,
      expectedVersion: '0.9.6',
      installedVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      reportCommit: 'ba888018',
      inputFingerprint: 'fingerprint',
      artifactDigest: 'artifact-digest',
      state: {
        graphifyVersion: '0.9.6',
        head: 'a7a6e9c0592878eb',
        inputFingerprint: 'fingerprint',
        artifactDigest: 'artifact-digest',
      },
    }),
    [],
    'a current cache state proves Graphify checked HEAD even when topology left the report untouched',
  );

  const reasons = cacheRefreshReasons({
    artifactsExist: false,
    artifactsValid: false,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.5',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'ba888018',
    inputFingerprint: 'new',
    artifactDigest: 'new-artifact',
    state: {
      graphifyVersion: '0.9.4',
      head: 'ba888018',
      inputFingerprint: 'old',
      artifactDigest: 'old-artifact',
    },
  });
  assert.ok(reasons.includes('graph artifacts are missing'));
  assert.ok(reasons.includes('installed Graphify 0.9.5 does not match 0.9.6'));
  assert.ok(reasons.includes('cached Graphify version differs from the required version'));
  assert.ok(reasons.includes('cached HEAD differs from current HEAD'));
  assert.ok(reasons.includes('graph-relevant working-tree inputs changed'));

  const bootstrapReasons = cacheRefreshReasons({
    artifactsExist: true,
    artifactsValid: true,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.6',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'ba888018',
    inputFingerprint: 'fingerprint',
    artifactDigest: 'artifact-digest',
    state: null,
  });
  assert.ok(bootstrapReasons.includes('graph source commit differs from HEAD'));
});

test('refreshes an invalid cache even when its state is current', () => {
  const reasons = cacheRefreshReasons({
    artifactsExist: true,
    artifactsValid: false,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.6',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'a7a6e9c0',
    inputFingerprint: 'fingerprint',
    artifactDigest: 'artifact-digest',
    state: {
      graphifyVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      inputFingerprint: 'fingerprint',
      artifactDigest: 'artifact-digest',
    },
  });
  assert.deepEqual(reasons, ['graph artifacts are invalid']);
});

test('refreshes when an interrupted write truncates a generated artifact', () => {
  const reasons = cacheRefreshReasons({
    artifactsExist: true,
    artifactsValid: true,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.6',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'a7a6e9c0',
    inputFingerprint: 'fingerprint',
    artifactDigest: 'truncated-report-digest',
    state: {
      graphifyVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      inputFingerprint: 'fingerprint',
      artifactDigest: 'complete-artifacts-digest',
    },
  });
  assert.deepEqual(reasons, ['generated graph artifacts changed outside refresh']);
});
