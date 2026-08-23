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
  it('serializes Date-typed deadlines from a lean document instead of dropping them', () => {
    const view = researchPlanViewFromDoc({
      stage: 'CONTACTED',
      deadlines: [{ label: 'app due', dueAt: new Date('2026-09-01T00:00:00.000Z') }],
    });
    expect(view.deadlines).toEqual([{ label: 'app due', dueAt: '2026-09-01T00:00:00.000Z' }]);
  });

  it('preserves a Date-typed completedAt on a completed checklist item', () => {
    const view = researchPlanViewFromDoc({
      checklist: [
        {
          label: 'submitted intent form',
          completed: true,
          completedAt: new Date('2026-01-15T00:00:00.000Z'),
        },
      ],
    });
    expect(view.checklist).toEqual([
      {
        label: 'submitted intent form',
        completed: true,
        completedAt: '2026-01-15T00:00:00.000Z',
      },
    ]);
  });

  it('still serializes ISO-string dates from a hydrated document', () => {
    const view = researchPlanViewFromDoc({
      deadlines: [{ label: 'app due', dueAt: '2026-09-01T00:00:00.000Z' }],
      checklist: [
        { label: 'sent email', completed: true, completedAt: '2026-01-15T00:00:00.000Z' },
      ],
    });
    expect(view.deadlines).toEqual([{ label: 'app due', dueAt: '2026-09-01T00:00:00.000Z' }]);
    expect(view.checklist[0]).toMatchObject({ completedAt: '2026-01-15T00:00:00.000Z' });
  });

  it('omits completedAt rather than fabricating a timestamp when the stored value is corrupt', () => {
    const view = researchPlanViewFromDoc({
      checklist: [{ label: 'corrupt stamp', completed: true, completedAt: new Date('not a date') }],
    });
    expect(view.checklist).toEqual([{ label: 'corrupt stamp', completed: true }]);
  });

  it('drops deadlines with an unparseable stored due date', () => {
    const view = researchPlanViewFromDoc({
      deadlines: [
        { label: 'valid', dueAt: new Date('2026-09-01T00:00:00.000Z') },
        { label: 'broken', dueAt: new Date('nope') },
      ],
    });
    expect(view.deadlines).toEqual([{ label: 'valid', dueAt: '2026-09-01T00:00:00.000Z' }]);
  });
});
