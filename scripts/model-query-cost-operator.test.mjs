import assert from 'node:assert/strict';
import test from 'node:test';
import { queryCostChildCommand } from './run-model-query-cost-profile.mjs';

test('query-cost profiles invoke only the fixed bounded read-only audit command', () => {
  assert.deepEqual(queryCostChildCommand('beta-inventory', '/tmp/query-cost.json'), [
    '--cwd',
    'server',
    'model-refactor:query-cost',
    '--environment',
    'beta',
    '--max-time-ms',
    '5000',
    '--strict',
    '--output',
    '/tmp/query-cost.json',
  ]);
  assert.deepEqual(
    queryCostChildCommand('production-copy-inventory', '/tmp/query-cost-copy.json'),
    [
      '--cwd',
      'server',
      'model-refactor:query-cost',
      '--environment',
      'production-copy',
      '--max-time-ms',
      '5000',
      '--strict',
      '--output',
      '/tmp/query-cost-copy.json',
    ],
  );
  assert.throws(() => queryCostChildCommand('production', '/tmp/query-cost.json'));
});
