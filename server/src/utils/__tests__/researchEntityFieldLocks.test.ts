import { describe, expect, it } from 'vitest';

import {
  fieldLockProvenancePath,
  fieldLockReason,
  isRevisitableFieldLock,
  planFieldLock,
} from '../researchEntityFieldLocks';

const declaration = {
  field: 'entityType',
  reason: 'engine_gap_workaround',
  lockedBy: 'repair-something',
} as const;

describe('planFieldLock', () => {
  it('returns the lock and its reason as one fragment, so neither can be written alone', () => {
    const update = planFieldLock([], declaration);
    expect(update.manuallyLockedFields).toEqual(['entityType']);
    expect(update['fieldLockProvenance.entityType']).toMatchObject({
      reason: 'engine_gap_workaround',
      lockedBy: 'repair-something',
      note: '',
    });
  });

  it('adds to the existing locks on the row rather than replacing them', () => {
    expect(planFieldLock(['name', 'websiteUrl'], declaration).manuallyLockedFields).toEqual([
      'name',
      'websiteUrl',
      'entityType',
    ]);
  });

  it('does not duplicate a field the row already locks, but does restate why', () => {
    const update = planFieldLock(['entityType'], declaration);
    expect(update.manuallyLockedFields).toEqual(['entityType']);
    expect(update['fieldLockProvenance.entityType']).toBeDefined();
  });

  it('ignores non-string entries in a corrupt lock list rather than propagating them', () => {
    expect(planFieldLock([null, 7, 'name'], declaration).manuallyLockedFields).toEqual([
      'name',
      'entityType',
    ]);
  });

  it('stamps the lock time, which fieldProvenance does not record', () => {
    const lockedAt = new Date('2026-01-02T03:04:05.000Z');
    expect(
      planFieldLock([], { ...declaration, lockedAt })['fieldLockProvenance.entityType'],
    ).toMatchObject({ lockedAt });
  });

  it('refuses a field name that would write to a different path than it claims', () => {
    for (const field of ['', ' ', 'fieldProvenance.websiteUrl', '$set', 'name ']) {
      expect(() => planFieldLock([], { ...declaration, field })).toThrow(/unusable field name/i);
    }
  });

  it('refuses a lock that names no author, since an unattributable lock is the defect', () => {
    expect(() => planFieldLock([], { ...declaration, lockedBy: '  ' })).toThrow(/must name/i);
  });

  it('refuses a reason outside the vocabulary', () => {
    expect(() => planFieldLock([], { ...declaration, reason: 'because' as never })).toThrow(
      /unknown field lock reason/i,
    );
  });

  it('refuses to declare a lock as unknown, which would record no reason at all', () => {
    expect(() => planFieldLock([], { ...declaration, reason: 'unknown' as never })).toThrow(
      /unknown field lock reason/i,
    );
  });
});

describe('fieldLockReason', () => {
  it('reports a lock applied before lock provenance existed as unknown', () => {
    expect(fieldLockReason(undefined, 'entityType')).toBe('unknown');
    expect(fieldLockReason({}, 'entityType')).toBe('unknown');
    expect(fieldLockReason({ websiteUrl: { reason: 'operator_decision' } }, 'entityType')).toBe(
      'unknown',
    );
  });

  it('reads a recorded reason back from a plain object and from a Mongoose Map alike', () => {
    const record = { reason: 'operator_decision' };
    expect(fieldLockReason({ entityType: record }, 'entityType')).toBe('operator_decision');
    expect(fieldLockReason(new Map([['entityType', record]]), 'entityType')).toBe(
      'operator_decision',
    );
  });

  it('reports an unrecognized stored reason as unknown rather than passing it through', () => {
    expect(fieldLockReason({ entityType: { reason: 'engine-gap' } }, 'entityType')).toBe('unknown');
    expect(fieldLockReason({ entityType: 'engine_gap_workaround' }, 'entityType')).toBe('unknown');
  });

  it('round-trips what planFieldLock writes', () => {
    const update = planFieldLock([], declaration);
    const stored = { entityType: update[fieldLockProvenancePath('entityType')] };
    expect(fieldLockReason(stored, 'entityType')).toBe('engine_gap_workaround');
  });
});

describe('isRevisitableFieldLock', () => {
  it('allows the engine to revisit only a lock positively recorded as a workaround', () => {
    expect(
      isRevisitableFieldLock({ entityType: { reason: 'engine_gap_workaround' } }, 'entityType'),
    ).toBe(true);
  });

  it('never revisits an operator decision', () => {
    expect(
      isRevisitableFieldLock({ entityType: { reason: 'operator_decision' } }, 'entityType'),
    ).toBe(false);
  });

  it('never revisits an unrecorded or unclassified lock, which is the pre-2612 corpus', () => {
    expect(isRevisitableFieldLock(undefined, 'entityType')).toBe(false);
    expect(isRevisitableFieldLock({}, 'entityType')).toBe(false);
    expect(isRevisitableFieldLock({ entityType: { reason: 'unknown' } }, 'entityType')).toBe(false);
  });
});
