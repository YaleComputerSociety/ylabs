import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  buildCaseInsensitiveNetidFilter,
  normalizeObjectIdStringForUserMutation,
  normalizeObjectIdsForUserMutation,
  normalizeUserLookupObjectId,
} from '../userService';
describe('buildCaseInsensitiveNetidFilter', () => {
  it('rejects malformed netids before building regex filters', () => {
    expect(() => buildCaseInsensitiveNetidFilter('.*+$[x]')).toThrow(/Invalid netid/);
    expect(() => buildCaseInsensitiveNetidFilter('a'.repeat(4096))).toThrow(/Invalid netid/);
  });

  it('rejects object-shaped netids without invoking arbitrary toString', () => {
    const objectNetid = {
      toString: () => 'aa123',
    };

    expect(() => buildCaseInsensitiveNetidFilter(objectNetid)).toThrow(/Invalid netid/);
  });

  it('preserves case-insensitive exact netid matching', () => {
    const filter = buildCaseInsensitiveNetidFilter('Aa123');
    const regex = new RegExp(filter.netid.$regex, filter.netid.$options);

    expect(regex.test('aa123')).toBe(true);
    expect(regex.test('xaa123')).toBe(false);
  });
});

describe('normalizeUserLookupObjectId', () => {
  it('accepts string and ObjectId account lookup ids', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';

    expect(normalizeUserLookupObjectId(id)).toBe(id);
    expect(normalizeUserLookupObjectId(new mongoose.Types.ObjectId(id))).toBe(id);
  });

  it('rejects object-shaped account lookup ids without invoking arbitrary toString', () => {
    expect(
      normalizeUserLookupObjectId({
        toString: () => '665f0b0c0b0c0b0c0b0c0b0c',
      }),
    ).toBeNull();
  });
});

describe('normalizeObjectIdsForUserMutation', () => {
  it('normalizes ObjectId instances without falling back to arbitrary object coercion', () => {
    const objectId = new mongoose.Types.ObjectId('665f0b0c0b0c0b0c0b0c0b0c');

    expect(normalizeObjectIdStringForUserMutation(objectId, 'favPathways')).toBe(
      '665f0b0c0b0c0b0c0b0c0b0c',
    );
  });

  it('normalizes valid ObjectId strings for account mutations', () => {
    const result = normalizeObjectIdsForUserMutation(
      ['665f0b0c0b0c0b0c0b0c0b0c'],
      'savedResearchPlans',
    );

    expect(result.map((id) => id.toString())).toEqual(['665f0b0c0b0c0b0c0b0c0b0c']);
  });

  it('rejects arbitrary object-shaped ids instead of invoking toString', () => {
    const objectIdLike = {
      toString: () => '665f0b0c0b0c0b0c0b0c0b0c',
    };

    expect(() => normalizeObjectIdsForUserMutation([objectIdLike], 'ownListings')).toThrow(
      /Invalid ownListings id/,
    );
  });

  it('rejects non-array account mutation batches before per-id work', () => {
    expect(() =>
      normalizeObjectIdsForUserMutation({ 0: '665f0b0c0b0c0b0c0b0c0b0c' } as any, 'ownListings'),
    ).toThrow(/Invalid ownListings ids/);
  });

  it('rejects malformed ids before they reach Mongo update paths', () => {
    expect(() => normalizeObjectIdsForUserMutation(['not-an-object-id'], 'favPathways')).toThrow(
      /Invalid favPathways id/,
    );
    try {
      normalizeObjectIdsForUserMutation(['not-an-object-id'], 'favPathways');
    } catch (error: any) {
      expect(error.status).toBe(400);
    }
  });

  it('rejects oversized account mutation batches before per-id work', () => {
    const ids = Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(24, '0'));

    expect(() => normalizeObjectIdsForUserMutation(ids, 'favPathways')).toThrow(
      /Too many favPathways ids/,
    );
    try {
      normalizeObjectIdsForUserMutation(ids, 'favPathways');
    } catch (error: any) {
      expect(error.status).toBe(400);
    }
  });
});
