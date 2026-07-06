import { describe, expect, it } from 'vitest';
import { buildSafeSearchRegex, escapeRegex } from '../regex';

describe('regex helpers', () => {
  it('escapes user-controlled regex metacharacters', () => {
    expect(escapeRegex('a+b?(test)[x]')).toBe('a\\+b\\?\\(test\\)\\[x\\]');
  });

  it('trims and caps safe search regex terms', () => {
    const regex = buildSafeSearchRegex(`  ${'a'.repeat(150)}  `);

    expect(regex.$regex).toBe('a'.repeat(100));
    expect(regex.$options).toBe('i');
  });

  it('drops unsupported regex options instead of forwarding them to Mongo', () => {
    expect(buildSafeSearchRegex('privacy', 'igz$mi').$options).toBe('im');
    expect(buildSafeSearchRegex('privacy', 'zzz').$options).toBe('i');
  });
});
