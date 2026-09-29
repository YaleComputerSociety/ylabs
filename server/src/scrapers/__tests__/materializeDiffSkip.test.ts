import { describe, expect, it } from 'vitest';
import {
  isMaterializerProjectionNoOp,
  materializerProjectionPathIsStorable,
} from '../entityMaterializer';

const SCHEMA_PATHS = [
  'name',
  'researchAreas',
  'websiteUrl',
  'methods',
  'fieldProvenance',
  'confidenceByField',
  'sourceLinkHealth.status',
  'lastObservedAt',
  'sourceContentHash',
];

describe('materializerProjectionPathIsStorable', () => {
  it('reads a declared path and a path declared only through its children', () => {
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'name')).toBe(true);
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'sourceLinkHealth')).toBe(true);
  });

  it('reads a dotted path as storable when an ancestor is declared', () => {
    expect(
      materializerProjectionPathIsStorable(SCHEMA_PATHS, 'fieldProvenance.researchAreas'),
    ).toBe(true);
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'confidenceByField.name')).toBe(true);
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'sourceLinkHealth.status')).toBe(
      true,
    );
  });

  it('reads an undeclared path as unstorable, and does not match on a shared prefix', () => {
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'inferredPiUserId')).toBe(false);
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'nam')).toBe(false);
    expect(materializerProjectionPathIsStorable(SCHEMA_PATHS, 'sourceLink')).toBe(false);
  });

  it('answers unknown rather than unstorable when no schema paths are supplied', () => {
    expect(materializerProjectionPathIsStorable([], 'inferredPiUserId')).toBe(true);
  });
});

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
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(true);
  });

  it('ignores managed lastObservedAt / sourceContentHash differences', () => {
    const doc = { name: 'Synthetic Lab', sourceContentHash: 'aaa' };
    const set = {
      name: 'Synthetic Lab',
      lastObservedAt: new Date(),
      sourceContentHash: 'bbb',
    };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(true);
  });

  it('detects a changed scalar field', () => {
    const doc = { name: 'Old Name' };
    const set = { name: 'New Name', lastObservedAt: new Date() };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(false);
  });

  it('detects a changed array field (order/content)', () => {
    const doc = { researchAreas: ['a', 'b'] };
    const set = { researchAreas: ['a', 'c'], lastObservedAt: new Date() };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(false);
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
    expect(isMaterializerProjectionNoOp(doc, same, {}, SCHEMA_PATHS)).toBe(true);
    const changed = {
      'fieldProvenance.name': { sourceName: 'other', confidence: 0.9 },
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, changed, {}, SCHEMA_PATHS)).toBe(false);
  });

  it('is a no-op when unset targets are already absent, a change when present', () => {
    const doc = { name: 'Synthetic Lab' };
    expect(
      isMaterializerProjectionNoOp(doc, { name: 'Synthetic Lab' }, { methods: '' }, SCHEMA_PATHS),
    ).toBe(true);
    const withMethods = { name: 'Synthetic Lab', methods: ['pcr'] };
    expect(
      isMaterializerProjectionNoOp(
        withMethods,
        { name: 'Synthetic Lab' },
        { methods: '' },
        SCHEMA_PATHS,
      ),
    ).toBe(false);
  });

  it('does not skip when the projection would set a field the doc lacks (bias to write)', () => {
    const doc = { name: 'Synthetic Lab' };
    const set = {
      name: 'Synthetic Lab',
      websiteUrl: 'https://lab.example.edu',
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(false);
  });

  it('#1191/#1192 guard: a derived field already stored and re-set identically stays a no-op (never dropped)', () => {
    const doc = { name: 'Synthetic Lab', websiteUrl: 'https://lab.example.edu' };
    const set = {
      name: 'Synthetic Lab',
      websiteUrl: 'https://lab.example.edu',
      lastObservedAt: new Date(),
    };
    // No unset of websiteUrl (not CLEARABLE_ON_EMPTY), so a shrunken log leaves it in place.
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(true);
  });

  it('#3869: a row whose only difference is a path the schema cannot store is a no-op', () => {
    const doc = { name: 'Synthetic Lab', researchAreas: ['immunology'] };
    const set = {
      name: 'Synthetic Lab',
      researchAreas: ['immunology'],
      inferredPiUserId: '6a8284b159dc8a22e5c39272',
      inferredPiUserKey: 'netid:ab123',
      contactInstructionsQuote: 'Email the lab to ask about openings.',
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(true);
  });

  it('#3869: one real difference alongside unstorable paths is still a write', () => {
    const doc = { name: 'Synthetic Lab', researchAreas: ['immunology'] };
    const set = {
      name: 'Synthetic Lab',
      researchAreas: ['immunology', 'genomics'],
      inferredPiUserId: '6a8284b159dc8a22e5c39272',
      lastObservedAt: new Date(),
    };
    expect(isMaterializerProjectionNoOp(doc, set, {}, SCHEMA_PATHS)).toBe(false);
  });

  it('#3869: without schema paths an unstorable difference still writes, so a missing schema cannot skip a real write', () => {
    const doc = { name: 'Synthetic Lab' };
    const set = { name: 'Synthetic Lab', inferredPiUserId: '6a8284b159dc8a22e5c39272' };
    expect(isMaterializerProjectionNoOp(doc, set, {}, [])).toBe(false);
  });

  it('#3869: an unset of a stored value under an undeclared path is still a write', () => {
    const doc = { name: 'Synthetic Lab', description: 'legacy prose no schema path declares' };
    expect(
      isMaterializerProjectionNoOp(
        doc,
        { name: 'Synthetic Lab' },
        { description: '' },
        SCHEMA_PATHS,
      ),
    ).toBe(false);
  });
});
