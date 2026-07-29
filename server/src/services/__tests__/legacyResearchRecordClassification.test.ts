import { describe, expect, it } from 'vitest';
import {
  MAX_PHASE4_CLASSIFICATION_RECORDS,
  planPhase4LegacyRecordClassifications,
  type Phase4LegacyRecordClassificationInput,
} from '../legacyResearchRecordClassification';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const LISTING_ID = '64a000000000000000000001';
const FELLOWSHIP_ID = '64a000000000000000000002';
const ENTITY_ID = '64a000000000000000000003';

function plan(input: Phase4LegacyRecordClassificationInput) {
  return planPhase4LegacyRecordClassifications([input], { now: NOW }).proposals[0];
}

describe('Phase 4 legacy record classification planner', () => {
  it('routes active research-role listings to a reviewed pathway and posting proposal', () => {
    const proposal = plan({
      sourceKind: 'LISTING',
      sourceId: LISTING_ID,
      researchEntityId: ENTITY_ID,
      researchEntityExists: true,
      type: 'ra',
      confirmed: true,
      expiresAt: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(proposal).toEqual({
      source: { kind: 'LISTING', id: LISTING_ID },
      target: { researchEntityId: ENTITY_ID },
      suggestedDisposition: 'POSTED_RESEARCH_ROLE',
      proposedArtifacts: ['ENTRY_PATHWAY', 'POSTED_OPPORTUNITY'],
      suggestedOpportunityStatus: 'OPEN',
      reasons: ['ACTIVE_LISTING'],
      blockers: [],
      review: {
        required: true,
        status: 'PENDING',
        owner: null,
        decision: null,
      },
    });
  });

  it('preserves historical listing semantics without calling the posting open', () => {
    expect(
      plan({
        sourceKind: 'LISTING',
        sourceId: LISTING_ID,
        researchEntityId: ENTITY_ID,
        researchEntityExists: true,
        type: 'volunteer',
        confirmed: true,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toMatchObject({
      suggestedDisposition: 'POSTED_RESEARCH_ROLE',
      suggestedOpportunityStatus: 'CLOSED',
      reasons: ['HISTORICAL_LISTING'],
    });
  });

  it.each(['thesis', 'independent-study'])(
    'keeps %s listings out of entry pathways as formalization-only suggestions',
    (type) => {
      expect(
        plan({
          sourceKind: 'LISTING',
          sourceId: LISTING_ID,
          researchEntityId: ENTITY_ID,
          researchEntityExists: true,
          type,
          confirmed: true,
        }),
      ).toMatchObject({
        suggestedDisposition: 'FORMALIZATION_ONLY',
        proposedArtifacts: ['FORMALIZATION_SUMMARY'],
        reasons: ['LISTING_IS_FORMALIZATION'],
      });
    },
  );

  it('blocks listing proposals that lack a canonical entity or reviewed listing type', () => {
    expect(
      plan({
        sourceKind: 'LISTING',
        sourceId: LISTING_ID,
        confirmed: false,
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['MISSING_RESEARCH_ENTITY', 'UNCONFIRMED_LISTING'],
    });

    expect(
      plan({
        sourceKind: 'LISTING',
        sourceId: LISTING_ID,
        researchEntityId: ENTITY_ID,
        researchEntityExists: true,
        type: 'ra',
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['UNCONFIRMED_LISTING'],
      target: { researchEntityId: ENTITY_ID },
    });
  });

  it('requires caller-confirmed canonical ResearchEntity existence and retains the private target', () => {
    expect(
      plan({
        sourceKind: 'LISTING',
        sourceId: LISTING_ID,
        researchEntityId: ENTITY_ID,
        type: 'ra',
        confirmed: true,
      }),
    ).toMatchObject({
      target: { researchEntityId: ENTITY_ID },
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['UNVERIFIED_RESEARCH_ENTITY'],
    });
  });

  it('routes funding fellowships to formalization instead of inventing an entry pathway', () => {
    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'TRAVEL_RESEARCH_GRANT',
        entryMode: 'SECURE_MENTOR_THEN_APPLY',
      }),
    ).toMatchObject({
      suggestedDisposition: 'FORMALIZATION_ONLY',
      proposedArtifacts: ['FORMALIZATION_SUMMARY'],
      reasons: ['PROGRAM_IS_FORMALIZATION_ONLY'],
    });

    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'FELLOWSHIP_FUNDING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['CONFLICTING_PROGRAM_CLASSIFICATION'],
    });
  });

  it('proposes a posting only when a research program has a real application window', () => {
    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'MENTOR_MATCHING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
        applicationLink: 'https://example.yale.edu/apply',
        deadline: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toMatchObject({
      suggestedDisposition: 'RESEARCH_PROGRAM_PATHWAY',
      proposedArtifacts: ['RESEARCH_ENTITY', 'ENTRY_PATHWAY', 'POSTED_OPPORTUNITY'],
      suggestedOpportunityStatus: 'OPEN',
      reasons: ['PROGRAM_PROVIDES_ENTRY_ROUTE', 'REAL_APPLICATION_WINDOW'],
    });

    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'APPLY_TO_PROGRAM',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
        applicationLink: 'https://user:password@example.yale.edu/apply',
      }),
    ).toMatchObject({
      proposedArtifacts: ['RESEARCH_ENTITY', 'ENTRY_PATHWAY'],
      reasons: ['PROGRAM_PROVIDES_ENTRY_ROUTE', 'NO_CURRENT_POSTING_EVIDENCE'],
    });
  });

  it('requires affirmative research relevance and keeps mentor-first programs out of pathways', () => {
    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'MENTOR_MATCHING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['UNREVIEWED_RESEARCH_RELEVANCE'],
    });

    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'SECURE_MENTOR_THEN_APPLY',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
      }),
    ).toMatchObject({
      suggestedDisposition: 'FORMALIZATION_ONLY',
      proposedArtifacts: ['FORMALIZATION_SUMMARY'],
      reasons: ['PROGRAM_IS_FORMALIZATION_ONLY', 'MENTOR_REQUIRED_BEFORE_APPLY'],
    });
  });

  it('fails closed on expired application evidence regardless of stale accepting state', () => {
    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'MENTOR_MATCHING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
        applicationLink: 'https://example.yale.edu/apply',
        isAcceptingApplications: true,
        deadline: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['EXPIRED_APPLICATION_EVIDENCE'],
    });

    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'MENTOR_MATCHING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
        reviewedResearchRelevance: 'RESEARCH_RELATED',
        applicationLink: 'https://example.yale.edu/apply',
        deadline: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['EXPIRED_APPLICATION_EVIDENCE'],
    });
  });

  it('archives explicitly non-research programs and holds unknown kinds for review', () => {
    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'OTHER',
        reviewedResearchRelevance: 'NOT_RESEARCH_RELATED',
      }),
    ).toMatchObject({
      suggestedDisposition: 'ARCHIVE_ONLY',
      proposedArtifacts: [],
      reasons: ['NON_RESEARCH_PROGRAM'],
    });

    expect(
      plan({
        sourceKind: 'FELLOWSHIP',
        sourceId: FELLOWSHIP_ID,
        programKind: 'OTHER',
      }),
    ).toMatchObject({
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      blockers: ['UNRESOLVED_PROGRAM_CLASSIFICATION'],
    });
  });

  it('sorts deterministically and never copies free text or contact fields into proposals', () => {
    const result = planPhase4LegacyRecordClassifications(
      [
        {
          sourceKind: 'LISTING',
          sourceId: LISTING_ID,
          researchEntityId: ENTITY_ID,
          researchEntityExists: true,
          type: 'ra',
          title: 'Private title',
          ownerEmail: 'private@example.edu',
        } as Phase4LegacyRecordClassificationInput,
        {
          sourceKind: 'FELLOWSHIP',
          sourceId: FELLOWSHIP_ID,
          programKind: 'FELLOWSHIP_FUNDING',
          contactEmail: 'private@example.edu',
        } as Phase4LegacyRecordClassificationInput,
      ],
      { now: NOW },
    );

    expect(result.proposals.map(({ source }) => source.kind)).toEqual(['FELLOWSHIP', 'LISTING']);
    expect(JSON.stringify(result)).not.toContain('Private title');
    expect(JSON.stringify(result)).not.toContain('private@example.edu');
    expect(result.proposals.every(({ review }) => review.decision === null)).toBe(true);
  });

  it('rejects unbounded, duplicate, and malformed input before producing a review plan', () => {
    const listing = {
      sourceKind: 'LISTING' as const,
      sourceId: LISTING_ID,
      researchEntityId: ENTITY_ID,
      researchEntityExists: true,
      type: 'ra',
      confirmed: true,
    };
    expect(() =>
      planPhase4LegacyRecordClassifications(
        Array.from({ length: MAX_PHASE4_CLASSIFICATION_RECORDS + 1 }, () => listing),
        { now: NOW },
      ),
    ).toThrow(/at most 500 records/);
    expect(() => planPhase4LegacyRecordClassifications([listing, listing], { now: NOW })).toThrow(
      /Duplicate legacy classification source/,
    );
    expect(() =>
      planPhase4LegacyRecordClassifications([{ ...listing, sourceId: 'not-an-object-id' }], {
        now: NOW,
      }),
    ).toThrow(/24-character MongoDB ObjectId/);
    expect(() =>
      planPhase4LegacyRecordClassifications([listing], { now: new Date('invalid') }),
    ).toThrow(/now must be a valid Date/);
    expect(() => planPhase4LegacyRecordClassifications([listing], {} as { now: Date })).toThrow(
      /now must be a valid Date/,
    );
  });
});
