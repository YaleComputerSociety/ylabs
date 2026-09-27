import { describe, expect, it } from 'vitest';
import { seededSample } from '../seededSample';

const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`);

describe('seededSample', () => {
  it('draws the same rows for the same seed', () => {
    expect(seededSample(ids, 20, 'a')).toEqual(seededSample([...ids].reverse(), 20, 'a'));
  });

  it('draws different rows for a different seed', () => {
    expect(seededSample(ids, 20, 'a')).not.toEqual(seededSample(ids, 20, 'b'));
  });

  it('keeps most of a sample when one row joins the population', () => {
    const before = new Set(seededSample(ids, 20, 'a'));
    const after = seededSample([...ids, 'id-new'], 20, 'a');
    expect(after.filter((id) => before.has(id)).length).toBeGreaterThanOrEqual(19);
  });

  it('never returns more rows than exist, or a duplicate', () => {
    expect(seededSample(['x', 'x', 'y'], 10, 'a').sort()).toEqual(['x', 'y']);
  });
});
