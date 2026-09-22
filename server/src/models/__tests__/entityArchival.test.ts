import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS,
  archivedEntityUpdate,
  archivedStudentVisibilityVerdictFilter,
  clearedStudentVisibilityVerdict,
  LIVE_ENTITY_FILTER,
  liveEntityFilter,
} from '../entityArchival';

describe('archivedEntityUpdate', () => {
  it('withdraws the student-visibility verdict in the same write that archives the row', () => {
    expect(archivedEntityUpdate()).toEqual({
      $set: { archived: true },
      $unset: {
        studentVisibilityTier: '',
        studentVisibilityComputedTier: '',
        studentVisibilityReasons: '',
        studentVisibilityComputedAt: '',
      },
    });
  });

  it('carries the caller fields without letting them restate the archived flag', () => {
    const canonicalGroupId = 'canonical';
    expect(archivedEntityUpdate({ canonicalGroupId, archived: false }).$set).toEqual({
      archived: false,
      canonicalGroupId,
    });
    expect(archivedEntityUpdate({ canonicalGroupId }).$set).toEqual({
      archived: true,
      canonicalGroupId,
    });
  });

  it('leaves operator intent and the review trail alone', () => {
    const cleared = Object.keys(clearedStudentVisibilityVerdict());
    expect(cleared).not.toContain('studentVisibilityOverrideTier');
    expect(cleared).not.toContain('studentVisibilitySuppressionReason');
    expect(cleared).not.toContain('studentVisibilityReviewedAt');
    expect(cleared).not.toContain('studentVisibilityReviewedByAccountId');
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
