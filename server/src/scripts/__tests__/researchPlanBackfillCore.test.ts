import { describe, expect, it } from 'vitest';
import {
  mapLegacyPlan,
  mapLegacyStage,
  planResearchPlanBackfill,
  researchPlanBackfillKey,
  type BackfillUserInput,
} from '../researchPlanBackfillCore';

const OBSERVED_AT = '2026-01-01T00:00:00.000Z';
const ACCOUNT_A = '64a0000000000000000000a1';
const ENTITY_A = '64a000000000000000000030';
const ENTITY_B = '64a000000000000000000031';

describe('mapLegacyStage', () => {
  it('maps legacy stage vocabulary to canonical stages', () => {
    expect(mapLegacyStage('saved')).toBe('SAVED');
    expect(mapLegacyStage('researching')).toBe('EXPLORING');
    expect(mapLegacyStage('ready')).toBe('PREPARING');
    expect(mapLegacyStage('acted')).toBe('CONTACTED');
    expect(mapLegacyStage('archived')).toBe('CLOSED');
  });

  it('passes through canonical stages and defaults unknown values to SAVED', () => {
    expect(mapLegacyStage('APPLIED')).toBe('APPLIED');
    expect(mapLegacyStage('nonsense')).toBe('SAVED');
    expect(mapLegacyStage(undefined)).toBe('SAVED');
  });
});

describe('mapLegacyPlan', () => {
  it('maps note, checklist map, and target deadline onto canonical fields', () => {
    const { fields, droppedLegacyFields } = mapLegacyPlan(
      {
        stage: 'researching',
        note: 'Reach out after the seminar',
        checklist: { 'Read papers': true, 'Email PI': false },
        targetDeadline: '2026-03-01',
        intent: 'thesis',
        followUpIntervalDays: 14,
        checklistHistory: [{ intent: 'thesis', label: 'x', completedAt: OBSERVED_AT }],
      },
      { observedAt: OBSERVED_AT },
    );

    expect(fields.stage).toBe('EXPLORING');
    expect(fields.privateNotes).toBe('Reach out after the seminar');
    expect(fields.checklist).toEqual([
      { label: 'Read papers', completed: true, completedAt: OBSERVED_AT },
      { label: 'Email PI', completed: false },
    ]);
    expect(fields.deadlines).toEqual([{ label: 'Target deadline', dueAt: '2026-03-01T00:00:00.000Z' }]);
    expect(droppedLegacyFields.sort()).toEqual(['checklistHistory', 'followUpIntervalDays', 'intent']);
  });

  it('produces canonical defaults for an empty legacy plan', () => {
    const { fields, droppedLegacyFields } = mapLegacyPlan(undefined, { observedAt: OBSERVED_AT });
    expect(fields.stage).toBe('SAVED');
    expect(fields.privateNotes).toBe('');
    expect(fields.checklist).toEqual([]);
    expect(fields.deadlines).toEqual([]);
    expect(droppedLegacyFields).toEqual([]);
  });
});

describe('planResearchPlanBackfill', () => {
  it('plans one row per saved entity and skips entities that already have a canonical plan', () => {
    const users: BackfillUserInput[] = [
      {
        netid: 'student1',
        accountId: ACCOUNT_A,
        savedResearchEntities: [ENTITY_A, ENTITY_B, ENTITY_A],
        savedResearchEntityPlans: { [ENTITY_A]: { note: 'Note A' } },
      },
    ];
    const existing = new Set<string>([researchPlanBackfillKey(ACCOUNT_A, ENTITY_B)]);

    const plan = planResearchPlanBackfill(users, existing, { observedAt: OBSERVED_AT });

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ accountId: ACCOUNT_A, targetId: ENTITY_A });
    expect(plan.rows[0].fields.privateNotes).toBe('Note A');
    expect(plan.conflictsByNetid.student1.collisions).toEqual([ENTITY_B]);
    expect(plan.stats).toMatchObject({ rowsPlanned: 1, collisions: 1, usersWithSaves: 1 });
  });

  it('records unresolved accounts as conflicts without planning rows', () => {
    const users: BackfillUserInput[] = [
      {
        netid: 'ghost',
        accountId: null,
        savedResearchEntities: [ENTITY_A],
        savedResearchEntityPlans: {},
      },
    ];

    const plan = planResearchPlanBackfill(users, new Set(), { observedAt: OBSERVED_AT });

    expect(plan.rows).toHaveLength(0);
    expect(plan.conflictsByNetid.ghost.unresolvedAccount).toBe(true);
    expect(plan.stats.unresolvedAccounts).toBe(1);
  });

  it('flags plan-map entries that have no matching saved entity as orphan plans', () => {
    const users: BackfillUserInput[] = [
      {
        netid: 'student2',
        accountId: ACCOUNT_A,
        savedResearchEntities: [ENTITY_A],
        savedResearchEntityPlans: { [ENTITY_B]: { note: 'orphan' } },
      },
    ];

    const plan = planResearchPlanBackfill(users, new Set(), { observedAt: OBSERVED_AT });

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].targetId).toBe(ENTITY_A);
    expect(plan.conflictsByNetid.student2.orphanPlans).toEqual([ENTITY_B]);
    expect(plan.stats.orphanPlans).toBe(1);
  });

  it('mutates the existing-key set so a single run never double-plans the same target', () => {
    const users: BackfillUserInput[] = [
      {
        netid: 'student3',
        accountId: ACCOUNT_A,
        savedResearchEntities: [ENTITY_A],
        savedResearchEntityPlans: {},
      },
      {
        netid: 'student3-again',
        accountId: ACCOUNT_A,
        savedResearchEntities: [ENTITY_A],
        savedResearchEntityPlans: {},
      },
    ];

    const plan = planResearchPlanBackfill(users, new Set(), { observedAt: OBSERVED_AT });

    expect(plan.stats.rowsPlanned).toBe(1);
    expect(plan.stats.collisions).toBe(1);
  });

  it('ignores users with no saved entities and no plans', () => {
    const users: BackfillUserInput[] = [
      { netid: 'empty', accountId: ACCOUNT_A, savedResearchEntities: [], savedResearchEntityPlans: {} },
    ];

    const plan = planResearchPlanBackfill(users, new Set(), { observedAt: OBSERVED_AT });

    expect(plan.stats.usersWithSaves).toBe(0);
    expect(plan.rows).toHaveLength(0);
  });
});
