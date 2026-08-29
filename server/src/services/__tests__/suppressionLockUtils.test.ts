import { describe, expect, it, vi } from 'vitest';
import {
  isSuppressed,
  omitSuppressionLockedFields,
  findSuppressionLockedRecord,
} from '../suppressionLockUtils';

describe('suppressionLockUtils', () => {
  describe('isSuppressed', () => {
    it('treats an absent suppression subdoc as not suppressed', () => {
      expect(isSuppressed(undefined)).toBe(false);
      expect(isSuppressed(null)).toBe(false);
      expect(isSuppressed({})).toBe(false);
      expect(isSuppressed({ suppression: {} })).toBe(false);
    });

    it('treats any present reason as suppressed', () => {
      expect(isSuppressed({ suppression: { reason: 'evidence_replaced' } })).toBe(true);
      expect(isSuppressed({ suppression: { reason: 'evidence_lost' } })).toBe(true);
      expect(isSuppressed({ suppression: { reason: 'duplicate_collapsed' } })).toBe(true);
      expect(isSuppressed({ suppression: { reason: 'source_audit' } })).toBe(true);
    });

    it('does not treat locked fields alone as suppression', () => {
      expect(isSuppressed({ suppression: { lockedFields: ['confidence'] } })).toBe(false);
    });
  });

  describe('omitSuppressionLockedFields', () => {
    it('returns the input untouched when nothing is locked', () => {
      const fields = { archived: false, confidence: 'HIGH' };
      expect(omitSuppressionLockedFields(fields, { suppression: {} })).toBe(fields);
      expect(omitSuppressionLockedFields(fields, null)).toBe(fields);
    });

    it('protects archived on a suppressed record so materializers cannot resurrect it', () => {
      expect(
        omitSuppressionLockedFields(
          { archived: false, confidence: 'HIGH', lastMaterializedAt: new Date(0) },
          { suppression: { reason: 'evidence_lost' } },
        ),
      ).toEqual({ confidence: 'HIGH', lastMaterializedAt: new Date(0) });
    });

    it('drops explicitly locked fields without touching the rest', () => {
      expect(
        omitSuppressionLockedFields(
          { archived: false, confidence: 'HIGH', observedAt: 'now' },
          { suppression: { lockedFields: ['confidence'] } },
        ),
      ).toEqual({ archived: false, observedAt: 'now' });
    });

    it('unions the reason-implied archived lock with explicit locked fields', () => {
      expect(
        omitSuppressionLockedFields(
          { archived: false, confidence: 'HIGH', observedAt: 'now' },
          { suppression: { reason: 'duplicate_collapsed', lockedFields: ['confidence'] } },
        ),
      ).toEqual({ observedAt: 'now' });
    });
  });

  describe('findSuppressionLockedRecord', () => {
    it('returns null for a model without findOne rather than throwing', async () => {
      await expect(findSuppressionLockedRecord({} as any, { _id: 1 })).resolves.toBeNull();
    });

    it('projects only the two suppression fields it needs', async () => {
      const select = vi.fn().mockReturnValue({ lean: () => Promise.resolve({ suppression: {} }) });
      const findOne = vi.fn().mockReturnValue({ select });
      await findSuppressionLockedRecord({ findOne } as any, { type: 'POSTED_OPENING' });
      expect(findOne).toHaveBeenCalledWith({ type: 'POSTED_OPENING' });
      expect(select).toHaveBeenCalledWith('suppression.reason suppression.lockedFields');
    });
  });
});
