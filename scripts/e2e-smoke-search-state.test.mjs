import assert from 'node:assert/strict';
import test from 'node:test';

import { accessibleNameFromAriaSnapshot, stuckSearchProblems } from './e2e-smoke-search-state.mjs';

const settled = { buttonName: 'Search', buttonDisabled: false, resultsBusy: 'false' };

test('reads the button accessible name from an aria snapshot', () => {
  assert.equal(accessibleNameFromAriaSnapshot('- button "Search"'), 'Search');
  assert.equal(accessibleNameFromAriaSnapshot('- button "Searching…"'), 'Searching…');
  assert.equal(accessibleNameFromAriaSnapshot('- button "Say \\"hi\\""'), 'Say "hi"');
  assert.equal(accessibleNameFromAriaSnapshot('- link "Search"'), null);
  assert.equal(accessibleNameFromAriaSnapshot(undefined), null);
});

test('a settled search reports no problems', () => {
  assert.deepEqual(stuckSearchProblems(settled), []);
});

test('any loading label fails the check without naming that label', () => {
  for (const buttonName of [
    'Searching…',
    'Searching...',
    'Loading',
    'SEARCH',
    ' Search ',
    '',
    null,
  ]) {
    const problems = stuckSearchProblems({ ...settled, buttonName });
    assert.equal(problems.length, 1, `expected ${JSON.stringify(buttonName)} to be flagged`);
    assert.match(problems[0], /stuck in its loading state/);
  }
});

test('a disabled button or busy results fail the check', () => {
  assert.match(stuckSearchProblems({ ...settled, buttonDisabled: true })[0], /disabled/);
  assert.match(stuckSearchProblems({ ...settled, resultsBusy: 'true' })[0], /aria-busy/);
  assert.match(stuckSearchProblems({ ...settled, resultsBusy: null })[0], /aria-busy/);
});
