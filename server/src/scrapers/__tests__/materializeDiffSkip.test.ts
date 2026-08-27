import { describe, expect, it } from 'vitest';
import { isMaterializerProjectionNoOp } from '../entityMaterializer';

describe('isMaterializerProjectionNoOp', () => {
  it('treats a re-projection with identical scoped values as a no-op', () => {
    const doc = {
      name: 'Synthetic Lab',
      researchAreas: ['immunology', 'genomics'],
      lastObservedAt: new Date('2020-01-01T00:00:00Z'),
    };
    const set = {
      name: 'Synthetic Lab',
      researchAreas: ['immunology', 'genomics'],
      lastObservedAt: new Date('2026-08-27T00:00:00Z'),
    };
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(true);
  });

  it('ignores managed lastObservedAt / sourceContentHash differences', () => {
    const doc = { name: 'Synthetic Lab', sourceContentHash: 'aaa' };
    const set = {
      name: 'Synthetic Lab',
      lastObservedAt: new Date(),
      sourceContentHash: 'bbb',
    };
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(true);
  });

  it('detects a changed scalar field', () => {
    const doc = { name: 'Old Name' };
    const set = { name: 'New Name', lastObservedAt: new Date() };
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(false);
  });

  it('detects a changed array field (order/content)', () => {
    const doc = { researchAreas: ['a', 'b'] };
    const set = { researchAreas: ['a', 'c'], lastObservedAt: new Date() };
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(false);
  });

  it('compares dotted provenance/confidence paths', () => {
    const doc = {
      fieldProvenance: { name: { sourceName: 'src', confidence: 0.9 } },
      confidenceByField: { name: 0.9 },
    };
    const same = {
      'fieldProvenance.name': { sourceName: 'src', confidence: 0.9 },
      'confidenceByField.name': 0.9,
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, same, {})).toBe(true);
    const changed = {
      'fieldProvenance.name': { sourceName: 'other', confidence: 0.9 },
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, changed, {})).toBe(false);
  });

  it('is a no-op when unset targets are already absent, a change when present', () => {
    const doc = { name: 'Synthetic Lab' };
    expect(isMaterializerProjectionNoOp(doc, { name: 'Synthetic Lab' }, { methods: '' })).toBe(
      true,
    );
    const withMethods = { name: 'Synthetic Lab', methods: ['pcr'] };
    expect(
      isMaterializerProjectionNoOp(withMethods, { name: 'Synthetic Lab' }, { methods: '' }),
    ).toBe(false);
  });

  it('does not skip when the projection would set a field the doc lacks (bias to write)', () => {
    const doc = { name: 'Synthetic Lab' };
    const set = {
      name: 'Synthetic Lab',
      websiteUrl: 'https://lab.example.edu',
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(false);
  });

  it('#1191/#1192 guard: a derived field already stored and re-set identically stays a no-op (never dropped)', () => {
    const doc = { name: 'Synthetic Lab', websiteUrl: 'https://lab.example.edu' };
    const set = {
      name: 'Synthetic Lab',
      websiteUrl: 'https://lab.example.edu',
      lastObservedAt: new Date(),
    };
    // No unset of websiteUrl (not CLEARABLE_ON_EMPTY), so a shrunken log leaves it in place.
    expect(isMaterializerProjectionNoOp(doc, set, {})).toBe(true);
  });
});
