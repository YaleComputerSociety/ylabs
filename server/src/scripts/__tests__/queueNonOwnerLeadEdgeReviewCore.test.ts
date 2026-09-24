import { describe, expect, it } from 'vitest';
import {
  NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN,
  lanesCitingUrlByEntity,
  normalizeCitingUrl,
  planNonOwnerLeadEdgeReviewQueue,
  summarizeNonOwnerLeadEdgeQueueExclusions,
  type NonOwnerLeadEdgeCandidate,
  type QueueObservation,
} from '../queueNonOwnerLeadEdgeReviewCore';

const ENTITY_KEY = 'dept-physics-a-lab';
const URL = 'https://example.yale.edu/people/somebody';
const cannotHost = () => true;

const candidate = (
  overrides: Partial<NonOwnerLeadEdgeCandidate> = {},
): NonOwnerLeadEdgeCandidate => ({
  edgeId: 'edge-1',
  personId: 'person-1',
  entityId: 'entity-1',
  entityKey: ENTITY_KEY,
  role: 'PI',
  citingUrl: URL,
  storedTitle: 'Postdoctoral Associate',
  entityArchived: false,
  entityTier: 'operator_review',
  entityHoldsALiveLead: false,
  ...overrides,
});

const observation = (overrides: Partial<QueueObservation> = {}): QueueObservation => ({
  entityKey: ENTITY_KEY,
  sourceName: 'dept-faculty-roster',
  sourceUrl: URL,
  ...overrides,
});

describe('non-owner lead edge review queue (#3260)', () => {
  it('matches both spellings of the retirement note this lane has written', () => {
    expect(
      NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN.test(
        'Retired as a lead claim on someone whose title cannot own a research home (#2880, #1897).',
      ),
    ).toBe(true);
    expect(
      NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN.test(
        'Retired as a lead claim on someone whose title cannot host a student (#2880).',
      ),
    ).toBe(true);
    expect(NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN.test('Detached as a same-surname lead')).toBe(
      false,
    );
  });

  it('queues an edge whose citing url one lane on that entity asserts', () => {
    const plan = planNonOwnerLeadEdgeReviewQueue([candidate()], [observation()], cannotHost);
    expect(plan.excluded).toEqual([]);
    expect(plan.queue).toHaveLength(1);
    expect(plan.queue[0].recoveredLane).toBe('dept-faculty-roster');
  });

  // The join is scoped to the entity on purpose. A shared department roster page is read
  // by several lanes for different people, so a global join by url alone reports a fact
  // about the page as ambiguity about this edge.
  it('does not read another entity’s lane as ambiguity on this one', () => {
    const plan = planNonOwnerLeadEdgeReviewQueue(
      [candidate()],
      [observation(), observation({ entityKey: 'dept-other-lab', sourceName: 'ysm-atoz-index' })],
      cannotHost,
    );
    expect(plan.queue).toHaveLength(1);
  });

  it('excludes an edge two lanes on its own entity both cite', () => {
    const plan = planNonOwnerLeadEdgeReviewQueue(
      [candidate()],
      [observation(), observation({ sourceName: 'ysm-faculty-directory' })],
      cannotHost,
    );
    expect(plan.queue).toEqual([]);
    expect(plan.excluded[0].reason).toBe('two-lanes-on-this-entity-cite-the-url');
  });

  // A grant record asserts funding, never that a page names a lead, so queueing it would
  // invite a restore on the wrong kind of evidence.
  it('excludes a lane recovered as a grant record', () => {
    for (const lane of ['nih-reporter', 'nsf-award-search', 'doe-osti']) {
      const plan = planNonOwnerLeadEdgeReviewQueue(
        [candidate()],
        [observation({ sourceName: lane })],
        cannotHost,
      );
      expect(plan.queue).toEqual([]);
      expect(plan.excluded[0].reason).toBe(
        'recovered-lane-is-a-grant-record-not-a-page-naming-a-lead',
      );
    }
  });

  it('excludes an edge citing no url, and one no observation on the entity cites', () => {
    expect(
      planNonOwnerLeadEdgeReviewQueue([candidate({ citingUrl: '' })], [observation()], cannotHost)
        .excluded[0].reason,
    ).toBe('edge-cites-no-url');
    expect(planNonOwnerLeadEdgeReviewQueue([candidate()], [], cannotHost).excluded[0].reason).toBe(
      'no-observation-on-this-entity-cites-the-url',
    );
  });

  // The provenance refusal sits behind the title test, so an edge whose subject can host
  // was never declined by the rule this queue is about.
  it('excludes an edge whose subject can host a research home', () => {
    const plan = planNonOwnerLeadEdgeReviewQueue([candidate()], [observation()], () => false);
    expect(plan.excluded[0].reason).toBe(
      'title-can-host-so-the-retirement-was-not-this-lane-s-rule',
    );
  });

  it('treats two spellings of one page as one page', () => {
    expect(normalizeCitingUrl('https://WWW.Example.yale.edu/people/x/')).toBe(
      'example.yale.edu/people/x',
    );
    const lanes = lanesCitingUrlByEntity([
      observation({ sourceUrl: 'https://example.yale.edu/people/somebody/' }),
      observation({ sourceUrl: 'http://www.example.yale.edu/people/somebody' }),
    ]);
    expect([...lanes.values()][0].size).toBe(1);
  });

  it('counts every exclusion reason it can emit', () => {
    const counts = summarizeNonOwnerLeadEdgeQueueExclusions([
      { reason: 'edge-cites-no-url' },
      { reason: 'edge-cites-no-url' },
      { reason: 'two-lanes-on-this-entity-cite-the-url' },
    ]);
    expect(counts['edge-cites-no-url']).toBe(2);
    expect(counts['two-lanes-on-this-entity-cite-the-url']).toBe(1);
    expect(counts['recovered-lane-is-a-grant-record-not-a-page-naming-a-lead']).toBe(0);
  });
});
