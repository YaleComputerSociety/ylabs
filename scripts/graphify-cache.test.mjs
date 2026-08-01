import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cacheRefreshReasons,
  commitsMatch,
  hashInputs,
  isGraphInputPath,
  parseInstalledGraphifyVersion,
  parseReportSourceCommit,
} from './graphify-cache-core.mjs';

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

test('refreshes for missing, stale, version-mismatched, or changed caches', () => {
  assert.deepEqual(
    cacheRefreshReasons({
      artifactsExist: true,
      expectedVersion: '0.9.6',
      installedVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      reportCommit: 'a7a6e9c0',
      inputFingerprint: 'fingerprint',
      state: {
        graphifyVersion: '0.9.6',
        head: 'a7a6e9c0592878eb',
        inputFingerprint: 'fingerprint',
      },
    }),
    [],
  );

  assert.deepEqual(
    cacheRefreshReasons({
      artifactsExist: true,
      expectedVersion: '0.9.6',
      installedVersion: '0.9.6',
      head: 'a7a6e9c0592878eb',
      reportCommit: 'ba888018',
      inputFingerprint: 'fingerprint',
      state: {
        graphifyVersion: '0.9.6',
        head: 'a7a6e9c0592878eb',
        inputFingerprint: 'fingerprint',
      },
    }),
    [],
    'a current cache state proves Graphify checked HEAD even when topology left the report untouched',
  );

  const reasons = cacheRefreshReasons({
    artifactsExist: false,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.5',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'ba888018',
    inputFingerprint: 'new',
    state: { graphifyVersion: '0.9.4', head: 'ba888018', inputFingerprint: 'old' },
  });
  assert.ok(reasons.includes('graph artifacts are missing'));
  assert.ok(reasons.includes('installed Graphify 0.9.5 does not match 0.9.6'));
  assert.ok(reasons.includes('cached Graphify version differs from the required version'));
  assert.ok(reasons.includes('cached HEAD differs from current HEAD'));
  assert.ok(reasons.includes('graph-relevant working-tree inputs changed'));

  const bootstrapReasons = cacheRefreshReasons({
    artifactsExist: true,
    expectedVersion: '0.9.6',
    installedVersion: '0.9.6',
    head: 'a7a6e9c0592878eb',
    reportCommit: 'ba888018',
    inputFingerprint: 'fingerprint',
    state: null,
  });
  assert.ok(bootstrapReasons.includes('graph source commit differs from HEAD'));
});
