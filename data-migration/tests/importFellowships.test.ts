import assert from 'assert/strict';
import test from 'node:test';
import { transformFellowshipRow } from '../importFellowships';

const ALL_SEVEN =
  'Africa;Asia;Europe;Latin America and Caribbean;Middle East & Persian Gulf;North America;Oceania';

test('collapses the full region enumeration to empty (no real geographic restriction)', () => {
  const row = transformFellowshipRow({
    title: 'Region-agnostic Scholarship',
    'filter_Global Region or Country': ALL_SEVEN,
  });
  assert.deepEqual(row.globalRegions, []);
});

test('collapses the full enumeration even when countries are mixed in', () => {
  const row = transformFellowshipRow({
    title: 'Catch-all Grant',
    'filter_Global Region or Country': `${ALL_SEVEN};France;Kenya`,
  });
  assert.deepEqual(row.globalRegions, []);
});

test('preserves a genuine multi-region subset', () => {
  const row = transformFellowshipRow({
    title: 'Africa and Asia Travel Grant',
    'filter_Global Region or Country': 'Africa;Asia',
  });
  assert.deepEqual(row.globalRegions, ['Africa', 'Asia']);
});

test('preserves a single region and drops non-top-level countries', () => {
  const row = transformFellowshipRow({
    title: 'Kenya Field Research',
    'filter_Global Region or Country': 'Africa;Kenya',
  });
  assert.deepEqual(row.globalRegions, ['Africa']);
});

test('leaves a region-less record empty', () => {
  const row = transformFellowshipRow({ title: 'No Region Grant' });
  assert.deepEqual(row.globalRegions, []);
});
