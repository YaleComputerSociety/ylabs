import { describe, expect, it } from 'vitest';
import { normalizeAliasValue, walkCanonicalAliasChain } from '../canonicalAliasService';

function chain(edges: Record<string, string | null>, live: Set<string>) {
  return {
    isLiveCanonical: async (id: string) => live.has(id),
    nextCanonical: async (id: string) => edges[id] ?? null,
  };
}

describe('normalizeAliasValue', () => {
  it('lowercases and trims email so a mixed-case lookup matches the stored value', () => {
    expect(normalizeAliasValue('email', '  Test.Person@Example.Test ')).toBe(
      'test.person@example.test',
    );
  });

  it('uppercases and trims orcid so a lowercased lookup matches the stored value', () => {
    expect(normalizeAliasValue('orcid', ' 0000-0002-1825-009x ')).toBe('0000-0002-1825-009X');
  });

  it('only trims values for identity-preserving namespaces like id, slug, and netid', () => {
    expect(normalizeAliasValue('id', '  abc123  ')).toBe('abc123');
    expect(normalizeAliasValue('slug', '  Old-Lab-Slug  ')).toBe('Old-Lab-Slug');
    expect(normalizeAliasValue('netid', '  AbC123  ')).toBe('AbC123');
  });
});

describe('walkCanonicalAliasChain', () => {
  it('returns the start id when it is already a live canonical', async () => {
    const result = await walkCanonicalAliasChain('A', chain({}, new Set(['A'])));
    expect(result).toBe('A');
  });

  it('follows the chain to the first live canonical', async () => {
    const result = await walkCanonicalAliasChain('A', chain({ A: 'B', B: 'C' }, new Set(['C'])));
    expect(result).toBe('C');
  });

  it('returns null on a cycle without looping forever', async () => {
    const result = await walkCanonicalAliasChain('A', chain({ A: 'B', B: 'A' }, new Set()));
    expect(result).toBeNull();
  });

  it('returns null (never a dangling id) when a deleted canonical dead-ends', async () => {
    const result = await walkCanonicalAliasChain('A', chain({ A: null }, new Set()));
    expect(result).toBeNull();
  });

  it('follows a superseding pointer off a deleted canonical to a live survivor', async () => {
    const result = await walkCanonicalAliasChain(
      'gone',
      chain({ gone: 'survivor' }, new Set(['survivor'])),
    );
    expect(result).toBe('survivor');
  });

  it('stops at the hop limit', async () => {
    const result = await walkCanonicalAliasChain('A', {
      ...chain({ A: 'B', B: 'C', C: 'D' }, new Set(['D'])),
      maxHops: 2,
    });
    expect(result).toBeNull();
  });
});
