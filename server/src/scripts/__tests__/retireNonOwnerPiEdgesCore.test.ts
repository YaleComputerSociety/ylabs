import { describe, expect, it } from 'vitest';
import {
  planTraineeRosterArchive,
  planNonOwnerPiEdgeRetirement,
  summarizeNonOwnerPiEdgeRefusals,
  type NonOwnerPiEdgeRow,
} from '../retireNonOwnerPiEdgesCore';

const isTrainee = (title?: string) => /postdoc|student/i.test(title || '');

const edge = (over: Partial<NonOwnerPiEdgeRow> = {}): NonOwnerPiEdgeRow => ({
  id: 'edge-1',
  personId: 'person-1',
  entityId: 'entity-1',
  role: 'PI',
  reviewStatus: 'UNREVIEWED',
  ...over,
});

const titles = new Map([
  ['person-1', 'Postdoctoral Associate'],
  ['person-2', 'Professor of Geology'],
]);

describe('planNonOwnerPiEdgeRetirement', () => {
  it('retires an unreviewed, evidence-free PI claim on someone who cannot host', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge()], isTrainee, titles);
    expect(plan.retire.map((row) => row.id)).toEqual(['edge-1']);
    expect(plan.refused).toEqual([]);
  });

  it('leaves a lead who can host alone', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge({ personId: 'person-2' })], isTrainee, titles);
    expect(plan.retire).toEqual([]);
    expect(plan.refused[0].reason).toBe('lead-can-host');
  });

  it('refuses an edge citing a source, since a page naming them deserves a human read', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ sourceName: 'dept-faculty-roster' })],
      isTrainee,
      titles,
    );
    expect(plan.retire).toEqual([]);
    expect(plan.refused[0].reason).toBe('edge-carries-provenance');
  });

  it('refuses an edge an operator already reviewed, whatever the verdict was', () => {
    for (const reviewStatus of ['CONFIRMED', 'DISPUTED', 'PENDING']) {
      const plan = planNonOwnerPiEdgeRetirement([edge({ reviewStatus })], isTrainee, titles);
      expect(plan.retire).toEqual([]);
      expect(plan.refused[0].reason).toBe('edge-already-reviewed');
    }
  });

  it('treats a missing reviewStatus as unreviewed rather than skipping it', () => {
    const plan = planNonOwnerPiEdgeRetirement(
      [edge({ reviewStatus: undefined })],
      isTrainee,
      titles,
    );
    expect(plan.retire).toHaveLength(1);
  });

  it('refuses a lead with no title at all, since absence is not evidence they are a trainee', () => {
    const plan = planNonOwnerPiEdgeRetirement([edge({ personId: 'person-3' })], isTrainee, titles);
    expect(plan.refused[0].reason).toBe('lead-can-host');
  });
});

describe('summarizeNonOwnerPiEdgeRefusals', () => {
  it('reports every reason including zeros', () => {
    const counts = summarizeNonOwnerPiEdgeRefusals([
      { reason: 'lead-can-host' },
      { reason: 'lead-can-host' },
    ]);
    expect(counts['lead-can-host']).toBe(2);
    expect(counts['edge-carries-provenance']).toBe(0);
    expect(counts['edge-already-reviewed']).toBe(0);
  });
});

describe('planTraineeRosterArchive', () => {
  const row = (over: Partial<Parameters<typeof planTraineeRosterArchive>[0][number]> = {}) => ({
    id: 'r1',
    title: 'Postdoctoral Associate',
    hasAccount: false,
    hasAnyRoleEdge: false,
    ...over,
  });

  it('archives only a trainee row with no account and no role edge', () => {
    const plan = planTraineeRosterArchive([row()], isTrainee);
    expect(plan.archive).toEqual(['r1']);
  });

  it('keeps a row that backs a Yale account, since removing it breaks that person access', () => {
    const plan = planTraineeRosterArchive([row({ hasAccount: true })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['backs a yale account']).toBe(1);
  });

  it('keeps a row holding any role edge, since a postdoc belongs on a lab member list', () => {
    const plan = planTraineeRosterArchive([row({ hasAnyRoleEdge: true })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['holds a role edge']).toBe(1);
  });

  it('keeps anyone whose title can host', () => {
    const plan = planTraineeRosterArchive([row({ title: 'Professor of Geology' })], isTrainee);
    expect(plan.archive).toEqual([]);
    expect(plan.keptBecause['lead can host']).toBe(1);
  });
});
