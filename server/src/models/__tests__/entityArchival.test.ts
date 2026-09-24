import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS,
  ARCHIVED_PRESERVED_STUDENT_VISIBILITY_FIELDS,
  archivedEntityUpdate,
  archivedStudentVisibilityVerdictFilter,
  clearedStudentVisibilityVerdict,
  LIVE_ENTITY_FILTER,
  liveEntityFilter,
  studentVisibilityFieldNames,
} from '../entityArchival';

describe('archivedEntityUpdate', () => {
  it('withdraws the student-visibility verdict in the same write that archives the row', () => {
    const update = archivedEntityUpdate('a-lane');
    expect(update.$set.archived).toBe(true);
    expect(update.$unset).toEqual({
      studentVisibilityTier: '',
      studentVisibilityComputedTier: '',
      studentVisibilityReasons: '',
      studentVisibilityComputedAt: '',
      studentVisibilityEvaluatedAt: '',
    });
  });

  it('records the archiving lane and the moment, so the write is attributable', () => {
    const update = archivedEntityUpdate('  research-entity:dedupe-by-pi  ');
    expect(update.$set.archivedReason).toBe('research-entity:dedupe-by-pi');
    expect(update.$set.archivedAt).toBeInstanceOf(Date);
  });

  it('refuses to archive a row without naming what archived it', () => {
    expect(() => archivedEntityUpdate('')).toThrow(/archivedReason/);
    expect(() => archivedEntityUpdate('   ')).toThrow(/archivedReason/);
    expect(() => archivedEntityUpdate(undefined as unknown as string)).toThrow(/archivedReason/);
  });

  it('carries the caller fields without letting them restate the archived flag', () => {
    const canonicalGroupId = 'canonical';
    expect(
      archivedEntityUpdate('a-lane', { canonicalGroupId, archived: false }).$set,
    ).toMatchObject({
      archived: false,
      canonicalGroupId,
    });
    expect(archivedEntityUpdate('a-lane', { canonicalGroupId }).$set).toMatchObject({
      archived: true,
      canonicalGroupId,
    });
  });

  it('leaves operator intent and the review trail alone', () => {
    const cleared = Object.keys(clearedStudentVisibilityVerdict());
    expect(ARCHIVED_PRESERVED_STUDENT_VISIBILITY_FIELDS).toEqual([
      'studentVisibilityOverrideTier',
      'studentVisibilitySuppressionReason',
      'studentVisibilityReviewedAt',
      'studentVisibilityReviewedByAccountId',
    ]);
    for (const field of ARCHIVED_PRESERVED_STUDENT_VISIBILITY_FIELDS) {
      expect(cleared).not.toContain(field);
    }
  });

  it('decides every student-visibility field, so a new one cannot default to surviving', () => {
    expect(
      [
        ...ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS,
        ...ARCHIVED_PRESERVED_STUDENT_VISIBILITY_FIELDS,
      ].sort(),
    ).toEqual(studentVisibilityFieldNames().sort());
  });
});

describe('archivedStudentVisibilityVerdictFilter', () => {
  it('matches an archived row that still stores any one verdict field', () => {
    expect(archivedStudentVisibilityVerdictFilter()).toEqual({
      archived: true,
      $or: ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS.map((field) => ({
        [field]: { $exists: true },
      })),
    });
  });
});

describe('liveEntityFilter', () => {
  it('spells live the way the serve paths do, so a null archived flag still reads live', () => {
    expect(LIVE_ENTITY_FILTER).toEqual({ archived: { $ne: true } });
  });

  it('keeps ownership of the archived clause when a caller passes its own match', () => {
    expect(liveEntityFilter({ entityType: 'LAB', archived: true })).toEqual({
      entityType: 'LAB',
      archived: { $ne: true },
    });
  });
});
