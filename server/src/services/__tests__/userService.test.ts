import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  MAX_SAVED_PROGRAM_NOTE_LENGTH,
  buildCaseInsensitiveNetidFilter,
  normalizeObjectIdStringForUserMutation,
  normalizeObjectIdsForUserMutation,
  normalizeUserLookupObjectId,
  sanitizeSavedProgramTrackingForResponse,
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

describe('sanitizeSavedProgramTrackingForResponse', () => {
  it('returns only bounded records keyed by canonical program ids', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';
    expect(
      sanitizeSavedProgramTrackingForResponse({
        [id]: {
          note: 'x'.repeat(MAX_SAVED_PROGRAM_NOTE_LENGTH + 20),
          stage: 'applied',
          revision: 4,
          updatedAt: '2026-07-11T12:00:00.000Z',
        },
        '__proto__.bad': { note: 'private', stage: 'applied' },
      }),
    ).toEqual({
      [id]: {
        note: 'x'.repeat(MAX_SAVED_PROGRAM_NOTE_LENGTH),
        stage: 'applied',
        revision: 4,
        updatedAt: '2026-07-11T12:00:00.000Z',
      },
    });
  });

  it('normalizes malformed stored metadata without exposing extra fields', () => {
    const id = '665f0b0c0b0c0b0c0b0c0b0c';
    expect(
      sanitizeSavedProgramTrackingForResponse({
        [id]: { note: 12, stage: 'admin', revision: -1, updatedAt: 'bad', secret: 'no' },
      })[id],
    ).toEqual({
      note: '',
      stage: 'not_applied',
      revision: 0,
      updatedAt: new Date(0).toISOString(),
    });
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

    expect(() => normalizeObjectIdsForUserMutation([objectIdLike], 'favListings')).toThrow(
      /Invalid favListings id/,
    );
  });

  it('rejects non-array account mutation batches before per-id work', () => {
    expect(() =>
      normalizeObjectIdsForUserMutation({ 0: '665f0b0c0b0c0b0c0b0c0b0c' } as any, 'favListings'),
    ).toThrow(/Invalid favListings ids/);
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
