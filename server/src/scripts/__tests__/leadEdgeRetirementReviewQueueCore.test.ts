import { describe, expect, it } from 'vitest';
import { laneNamesByCitation } from '../backfillLeadEdgeSourceNameCore';
import {
  buildLeadEdgeReviewQueue,
  cannotHostReasonFor,
  summarizeLeadEdgeReviewQueue,
  type RetiredLeadEdgeInput,
  type ReviewQueueEntity,
  type ReviewQueuePerson,
} from '../leadEdgeRetirementReviewQueueCore';

const URL = 'https://medicine.yale.edu/lab/fixture/';
const lanes = laneNamesByCitation([
  { entityKey: 'ysm-fixture', sourceUrl: URL, sourceName: 'ysm-atoz-index' },
]);
const entity = (o: Partial<ReviewQueueEntity> = {}): ReviewQueueEntity => ({
  id: 'ent1',
  slug: 'ysm-fixture',
  name: 'Fixture Lab',
  tier: 'operator_review',
  archived: false,
  hasCard: true,
  topicCount: 3,
  hasWebsite: true,
  liveLeadCount: 0,
  ...o,
});
const person: ReviewQueuePerson = {
  id: 'p1',
  displayName: 'Fixture Lead',
  title: 'Postdoctoral Associate',
};
const edge = (o: Partial<RetiredLeadEdgeInput> = {}): RetiredLeadEdgeInput => ({
  id: 'e1',
  personId: 'p1',
  entityId: 'ent1',
  role: 'PI',
  reviewNotes: 'Retired as a lead claim on someone whose title cannot host a student (#2880).',
  citedSourceUrl: URL,
  ...o,
});
const trainee = (t?: string) => /postdoc/i.test(t ?? '');
const staff = (t?: string) => /administrator/i.test(t ?? '');

const build = (edges: RetiredLeadEdgeInput[], ent = entity()) =>
  buildLeadEdgeReviewQueue(
    edges,
    lanes,
    new Map([[ent.id, ent]]),
    new Map([[person.id, person]]),
    trainee,
    staff,
  );

describe('lead-edge retirement review queue (#3260)', () => {
  it('gives a reviewer the guard view, the person and what the entity serves, with no decision', () => {
    const { rows } = build([edge()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].guardSees).toEqual({ citedSourceUrl: URL, sourceName: 'ysm-atoz-index' });
    expect(rows[0].person.cannotHostReason).toBe('trainee-level-title');
    expect(rows[0].entity.servesCard).toBe(true);
    expect(rows[0].entity.liveLeadCount).toBe(0);
    // Never pre-decided: the queue exists because these need reading.
    expect(rows[0].decision).toBe('');
    expect(rows[0].reviewerNote).toBe('');
  });

  it('excludes a row a reviewer could not read, with the reason, rather than queueing it', () => {
    expect(build([edge({ citedSourceUrl: '' })]).excluded['no-cited-url']).toBe(1);
    expect(
      build([edge({ citedSourceUrl: 'https://example.test/other/' })]).excluded[
        'no-observation-cites-this-url'
      ],
    ).toBe(1);
    const ambiguous = laneNamesByCitation([
      { entityKey: 'ysm-fixture', sourceUrl: URL, sourceName: 'a' },
      { entityKey: 'ysm-fixture', sourceUrl: URL, sourceName: 'b' },
    ]);
    const q = buildLeadEdgeReviewQueue(
      [edge()],
      ambiguous,
      new Map([['ent1', entity()]]),
      new Map([[person.id, person]]),
      trainee,
      staff,
    );
    expect(q.rows).toEqual([]);
    expect(q.excluded['observations-disagree-on-lane']).toBe(1);
  });

  it('excludes an edge on an archived entity, because nobody can reach that row to judge it', () => {
    const q = build([edge()], entity({ archived: true }));
    expect(q.rows).toEqual([]);
    expect(q.excluded['entity-archived']).toBe(1);
  });

  it('prefers a stored sourceName over re-deriving one', () => {
    const { rows } = build([edge({ storedSourceName: 'dept-faculty-roster' })]);
    expect(rows[0].guardSees.sourceName).toBe('dept-faculty-roster');
  });

  it('reports why the title cannot host, including when it no longer matches', () => {
    expect(cannotHostReasonFor('Postdoctoral Associate', trainee, staff)).toBe(
      'trainee-level-title',
    );
    expect(cannotHostReasonFor('Administrator', trainee, staff)).toBe('non-research-staff-title');
    expect(cannotHostReasonFor('Postdoc Administrator', trainee, staff)).toBe(
      'trainee-and-non-research-staff',
    );
    expect(cannotHostReasonFor('Professor of Physics', trainee, staff)).toBe(
      'title-no-longer-matches',
    );
  });

  it('summarizes without collapsing the served count into the total', () => {
    const s = summarizeLeadEdgeReviewQueue(build([edge()], entity({ tier: 'student_ready' })));
    expect(s.queued).toBe(1);
    expect(s.servedEntities).toBe(1);
    expect(s.entitiesWithNoOtherLead).toBe(1);
    expect(s.byTier.student_ready).toBe(1);
  });
});
