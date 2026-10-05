import { describe, expect, it } from 'vitest';
import { routeParam } from '../routeParams';

describe('routeParam', () => {
  it('returns a named param value', () => {
    expect(routeParam({ params: { id: 'abc' } }, 'id')).toBe('abc');
  });

  it('reads a wildcard segment list or a missing param as empty', () => {
    expect(routeParam({ params: { id: ['a', 'b'] } }, 'id')).toBe('');
    expect(routeParam({ params: {} }, 'id')).toBe('');
  });
});
