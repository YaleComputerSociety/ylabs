import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  evidenceMemberOf,
  mergedInEntityKeysAndIds,
  mergedInMemberOf,
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
} from '../mergedRowEvidenceIdentity';

const rowId = new mongoose.Types.ObjectId();
const mergedInId = new mongoose.Types.ObjectId();
const foreignId = new mongoose.Types.ObjectId();
const identity = mergedRowEvidenceIdentity({ _id: rowId, slug: 'synthetic-row' }, [
  { _id: mergedInId, slug: 'synthetic-merged-row' },
]);

describe('mergedRowEvidenceIdentity', () => {
  it('assigns each identity form of a member to that member', () => {
    const byKey = evidenceMemberOf(identity, { entityKey: 'synthetic-merged-row' });
    const byId = evidenceMemberOf(identity, { entityId: mergedInId });

    expect(byKey).toBeDefined();
    expect(byId).toBe(byKey);
    expect(evidenceMemberOf(identity, { entityKey: 'synthetic-row' })).toBe(identity.rowMember);
    expect(evidenceMemberOf(identity, { entityId: rowId.toHexString() })).toBe(identity.rowMember);
  });

  it('keeps an id-anchored observation with its id even when its key names a member', () => {
    expect(
      evidenceMemberOf(identity, { entityId: foreignId, entityKey: 'synthetic-merged-row' }),
    ).toBeUndefined();
  });

  it('attributes relinked prose filed under the row id and a merged-in key to that merged-in row (#4741)', () => {
    const relinked = { entityId: rowId, entityKey: 'synthetic-merged-row' };
    expect(evidenceMemberOf(identity, { ...relinked, field: 'shortDescription' })).toBe(
      evidenceMemberOf(identity, { entityId: mergedInId }),
    );
    expect(mergedInMemberOf(identity, { ...relinked, field: 'fullDescription' })?.slug).toBe(
      'synthetic-merged-row',
    );
  });

  it('keeps a relinked identity field such as the name with the row (#4741)', () => {
    expect(
      evidenceMemberOf(identity, {
        entityId: rowId,
        entityKey: 'synthetic-merged-row',
        field: 'name',
      }),
    ).toBe(identity.rowMember);
  });

  it('reports which merged-in row an observation came from and nothing for the row itself', () => {
    expect(mergedInMemberOf(identity, { entityKey: 'synthetic-merged-row' })?.slug).toBe(
      'synthetic-merged-row',
    );
    expect(mergedInMemberOf(identity, { entityKey: 'synthetic-row' })).toBeUndefined();
    expect(mergedInEntityKeysAndIds(identity).sort()).toEqual(
      [mergedInId.toHexString(), 'synthetic-merged-row'].sort(),
    );
  });

  it('queries an id-anchored observation by id and a key-only one by key', () => {
    const clauses = mergedRowEvidenceQueryClauses([identity]);

    expect(clauses).toHaveLength(2);
    expect(clauses[1]).toEqual({
      entityId: null,
      entityKey: { $in: ['synthetic-row', 'synthetic-merged-row'] },
    });
  });
});
