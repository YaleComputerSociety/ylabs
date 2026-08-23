import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH,
  boundSavedResearchEntitySummaryText,
  normalizeResearchPlanUpdate,
  researchPlanViewFromDoc,
} from '../researchPlanService';
import {
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
} from '../../models/researchPlan';

describe('boundSavedResearchEntitySummaryText', () => {
  it('bounds the saved-entity summary description to the limit', () => {
    expect(
      boundSavedResearchEntitySummaryText(
        's'.repeat(MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH + 1),
        MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH,
      ),
    ).toHaveLength(MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH);
  });

  it('returns undefined for empty or non-string values', () => {
    expect(boundSavedResearchEntitySummaryText('', 10)).toBeUndefined();
    expect(boundSavedResearchEntitySummaryText(42, 10)).toBeUndefined();
  });
});

describe('normalizeResearchPlanUpdate', () => {
  it('keeps only valid canonical stages', () => {
    expect(normalizeResearchPlanUpdate({ stage: 'CONTACTED' })).toEqual({ stage: 'CONTACTED' });
    expect(normalizeResearchPlanUpdate({ stage: 'saved' })).toEqual({});
    expect(normalizeResearchPlanUpdate({ stage: 42 })).toEqual({});
  });

  it('maps the legacy note alias onto privateNotes and bounds its length', () => {
    expect(normalizeResearchPlanUpdate({ note: 'Email the PI' })).toEqual({
      privateNotes: 'Email the PI',
    });
    const update = normalizeResearchPlanUpdate({
      privateNotes: 'a'.repeat(MAX_RESEARCH_PLAN_NOTES_LENGTH + 50),
    });
    expect((update.privateNotes as string).length).toBe(MAX_RESEARCH_PLAN_NOTES_LENGTH);
  });

  it('normalizes checklist items and stamps completedAt for completed entries', () => {
    const update = normalizeResearchPlanUpdate({
      checklist: [
        { label: 'Read papers', completed: false },
        { label: 'Sent email', completed: true, completedAt: '2026-01-02T00:00:00.000Z' },
        { label: '', completed: false },
        { completed: true },
      ],
    });
    const checklist = update.checklist as Array<Record<string, unknown>>;
    expect(checklist).toHaveLength(2);
    expect(checklist[0]).toEqual({ label: 'Read papers', completed: false });
    expect(checklist[1]).toMatchObject({
      label: 'Sent email',
      completed: true,
      completedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('bounds checklist length to the model maximum', () => {
    const update = normalizeResearchPlanUpdate({
      checklist: Array.from({ length: MAX_RESEARCH_PLAN_CHECKLIST_ITEMS + 10 }, (_, index) => ({
        label: `Item ${index}`,
        completed: false,
      })),
    });
    expect((update.checklist as unknown[]).length).toBe(MAX_RESEARCH_PLAN_CHECKLIST_ITEMS);
  });

  it('normalizes deadlines and drops entries without a valid due date', () => {
    const update = normalizeResearchPlanUpdate({
      deadlines: [
        { label: 'Application', dueAt: '2026-03-01T00:00:00.000Z' },
        { label: 'No date' },
        { dueAt: '2026-03-01T00:00:00.000Z' },
      ],
    });
    expect(update.deadlines).toEqual([{ label: 'Application', dueAt: '2026-03-01T00:00:00.000Z' }]);
  });

  it('coerces export preferences to booleans', () => {
    expect(
      normalizeResearchPlanUpdate({ exportPreferences: { includePrivateNotes: true } })
        .exportPreferences,
    ).toEqual({
      includePrivateNotes: true,
      includeChecklist: false,
      includeDeadlines: false,
    });
  });

  it('omits fields that are not present in the input', () => {
    expect(normalizeResearchPlanUpdate({})).toEqual({});
  });
});

describe('researchPlanViewFromDoc', () => {
  it('serializes deadlines whose dueAt is a persisted Date instead of dropping them', () => {
    const view = researchPlanViewFromDoc({
      stage: 'APPLIED',
      deadlines: [{ label: 'app due', dueAt: new Date('2026-09-01T00:00:00.000Z') }],
    });
    expect(view.stage).toBe('APPLIED');
    expect(view.deadlines).toEqual([{ label: 'app due', dueAt: '2026-09-01T00:00:00.000Z' }]);
  });

  it('preserves the stored completedAt Date on completed checklist items instead of stamping now', () => {
    const view = researchPlanViewFromDoc({
      checklist: [
        { label: 'submitted intent form', completed: true, completedAt: new Date('2026-01-15T00:00:00.000Z') },
      ],
    });
    expect(view.checklist).toEqual([
      { label: 'submitted intent form', completed: true, completedAt: '2026-01-15T00:00:00.000Z' },
    ]);
  });

  it('accepts ISO-string dates as well as Date instances', () => {
    const view = researchPlanViewFromDoc({
      deadlines: [{ label: 'string due', dueAt: '2026-03-01T00:00:00.000Z' }],
      checklist: [{ label: 'string done', completed: true, completedAt: '2026-02-01T00:00:00.000Z' }],
    });
    expect(view.deadlines).toEqual([{ label: 'string due', dueAt: '2026-03-01T00:00:00.000Z' }]);
    expect(view.checklist).toEqual([
      { label: 'string done', completed: true, completedAt: '2026-02-01T00:00:00.000Z' },
    ]);
  });

  it('omits completedAt for incomplete checklist items', () => {
    const view = researchPlanViewFromDoc({
      checklist: [{ label: 'read papers', completed: false }],
    });
    expect(view.checklist).toEqual([{ label: 'read papers', completed: false }]);
  });

  it('fails loud on a completed checklist item with an unparseable completedAt', () => {
    expect(() =>
      researchPlanViewFromDoc({
        checklist: [{ label: 'broken', completed: true, completedAt: 'not-a-date' }],
      }),
    ).toThrow(/completedAt/);
  });

  it('fails loud on a persisted deadline with an unparseable dueAt', () => {
    expect(() =>
      researchPlanViewFromDoc({ deadlines: [{ label: 'broken', dueAt: 'not-a-date' }] }),
    ).toThrow(/dueAt/);
  });

  it('serializes updatedAt from a persisted Date', () => {
    const view = researchPlanViewFromDoc({ updatedAt: new Date('2026-08-23T12:00:00.000Z') });
    expect(view.updatedAt).toBe('2026-08-23T12:00:00.000Z');
  });
});
