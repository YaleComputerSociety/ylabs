import type { ProgramEntryMode, ProgramKind } from '../models/fellowship';
import type { PostedOpportunityStatus } from '../models/researchAccessTypes';
import { isPublicHttpUrl } from '../utils/urlSafety';

export const MAX_PHASE4_CLASSIFICATION_RECORDS = 500;

export const phase4ProposedArtifactKinds = [
  'RESEARCH_ENTITY',
  'ENTRY_PATHWAY',
  'POSTED_OPPORTUNITY',
  'FORMALIZATION_SUMMARY',
] as const;
export type Phase4ProposedArtifactKind = (typeof phase4ProposedArtifactKinds)[number];

export const phase4SuggestedDispositions = [
  'POSTED_RESEARCH_ROLE',
  'RESEARCH_PROGRAM_PATHWAY',
  'FORMALIZATION_ONLY',
  'ARCHIVE_ONLY',
  'MANUAL_REVIEW',
] as const;
export type Phase4SuggestedDisposition = (typeof phase4SuggestedDispositions)[number];

export const phase4ClassificationReasons = [
  'ACTIVE_LISTING',
  'HISTORICAL_LISTING',
  'LISTING_IS_FORMALIZATION',
  'PROGRAM_PROVIDES_ENTRY_ROUTE',
  'PROGRAM_IS_FORMALIZATION_ONLY',
  'MENTOR_REQUIRED_BEFORE_APPLY',
  'REAL_APPLICATION_WINDOW',
  'NO_CURRENT_POSTING_EVIDENCE',
  'NON_RESEARCH_PROGRAM',
  'UNCLASSIFIED_LEGACY_RECORD',
] as const;
export type Phase4ClassificationReason = (typeof phase4ClassificationReasons)[number];

export const phase4ClassificationBlockers = [
  'MISSING_RESEARCH_ENTITY',
  'INVALID_RESEARCH_ENTITY_ID',
  'UNVERIFIED_RESEARCH_ENTITY',
  'UNCONFIRMED_LISTING',
  'MISSING_LISTING_TYPE',
  'UNSUPPORTED_LISTING_TYPE',
  'UNRESOLVED_PROGRAM_CLASSIFICATION',
  'UNRESOLVED_PROGRAM_ENTRY_MODE',
  'UNREVIEWED_RESEARCH_RELEVANCE',
  'CONFLICTING_PROGRAM_CLASSIFICATION',
  'CONFLICTING_APPLICATION_STATE',
  'EXPIRED_APPLICATION_EVIDENCE',
  'INVALID_APPLICATION_DEADLINE',
] as const;
export type Phase4ClassificationBlocker = (typeof phase4ClassificationBlockers)[number];

export interface Phase4ListingClassificationInput {
  sourceKind: 'LISTING';
  sourceId: string;
  researchEntityId?: string;
  researchEntityExists?: boolean;
  type?: string;
  confirmed?: boolean;
  archived?: boolean;
  expiresAt?: Date;
}

export interface Phase4FellowshipClassificationInput {
  sourceKind: 'FELLOWSHIP';
  sourceId: string;
  programKind?: ProgramKind | string;
  entryMode?: ProgramEntryMode | string;
  reviewedResearchRelevance?: 'RESEARCH_RELATED' | 'NOT_RESEARCH_RELATED';
  applicationLink?: string;
  isAcceptingApplications?: boolean;
  deadline?: Date;
  archived?: boolean;
}

export type Phase4LegacyRecordClassificationInput =
  | Phase4ListingClassificationInput
  | Phase4FellowshipClassificationInput;

export interface Phase4LegacyRecordClassificationProposal {
  source: {
    kind: Phase4LegacyRecordClassificationInput['sourceKind'];
    id: string;
  };
  target?: {
    researchEntityId: string;
  };
  suggestedDisposition: Phase4SuggestedDisposition;
  proposedArtifacts: Phase4ProposedArtifactKind[];
  suggestedOpportunityStatus?: PostedOpportunityStatus;
  reasons: Phase4ClassificationReason[];
  blockers: Phase4ClassificationBlocker[];
  review: {
    required: true;
    status: 'PENDING';
    owner: null;
    decision: null;
  };
}

export interface Phase4LegacyRecordClassificationPlan {
  schemaVersion: 1;
  proposals: Phase4LegacyRecordClassificationProposal[];
}

const MONGO_OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const LISTING_POSTING_TYPES = new Set(['ra', 'volunteer']);
const LISTING_FORMALIZATION_TYPES = new Set(['independent-study', 'thesis']);
const PROGRAM_PATHWAY_KINDS = new Set<ProgramKind>([
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
]);
const PROGRAM_FORMALIZATION_KINDS = new Set<ProgramKind>([
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
]);

const PENDING_REVIEW = Object.freeze({
  required: true as const,
  status: 'PENDING' as const,
  owner: null,
  decision: null,
});

function codePointCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizedSourceId(value: unknown): string {
  if (typeof value !== 'string' || !MONGO_OBJECT_ID_PATTERN.test(value.trim())) {
    throw new TypeError('sourceId must be a 24-character MongoDB ObjectId string.');
  }
  return value.trim().toLowerCase();
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validResearchEntityId(value: unknown): boolean {
  return typeof value === 'string' && MONGO_OBJECT_ID_PATTERN.test(value.trim());
}

function researchEntityReview(
  value: unknown,
  exists: unknown,
): {
  target?: Phase4LegacyRecordClassificationProposal['target'];
  blockers: Phase4ClassificationBlocker[];
} {
  if (value === undefined || value === null || value === '') {
    return { blockers: ['MISSING_RESEARCH_ENTITY'] };
  }
  if (!validResearchEntityId(value)) {
    return { blockers: ['INVALID_RESEARCH_ENTITY_ID'] };
  }
  const target = { researchEntityId: (value as string).trim().toLowerCase() };
  return {
    target,
    blockers: exists === true ? [] : ['UNVERIFIED_RESEARCH_ENTITY'],
  };
}

function listingProposal(
  input: Phase4ListingClassificationInput,
  now: Date,
): Phase4LegacyRecordClassificationProposal {
  const source = { kind: input.sourceKind, id: normalizedSourceId(input.sourceId) };
  const entityReview = researchEntityReview(input.researchEntityId, input.researchEntityExists);
  const { target, blockers: entityBlockers } = entityReview;
  const type = typeof input.type === 'string' ? input.type.trim().toLowerCase() : '';

  if (input.confirmed !== true) {
    return {
      source,
      ...(target ? { target } : {}),
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
      blockers: [...entityBlockers, 'UNCONFIRMED_LISTING'],
      review: { ...PENDING_REVIEW },
    };
  }

  if (!type) {
    return {
      source,
      ...(target ? { target } : {}),
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
      blockers: [...entityBlockers, 'MISSING_LISTING_TYPE'],
      review: { ...PENDING_REVIEW },
    };
  }

  if (LISTING_FORMALIZATION_TYPES.has(type)) {
    return {
      source,
      ...(target ? { target } : {}),
      suggestedDisposition: entityBlockers.length ? 'MANUAL_REVIEW' : 'FORMALIZATION_ONLY',
      proposedArtifacts: entityBlockers.length ? [] : ['FORMALIZATION_SUMMARY'],
      reasons: ['LISTING_IS_FORMALIZATION'],
      blockers: entityBlockers,
      review: { ...PENDING_REVIEW },
    };
  }

  if (!LISTING_POSTING_TYPES.has(type)) {
    return {
      source,
      ...(target ? { target } : {}),
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
      blockers: [...entityBlockers, 'UNSUPPORTED_LISTING_TYPE'],
      review: { ...PENDING_REVIEW },
    };
  }

  if (entityBlockers.length) {
    return {
      source,
      ...(target ? { target } : {}),
      suggestedDisposition: 'MANUAL_REVIEW',
      proposedArtifacts: [],
      reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
      blockers: entityBlockers,
      review: { ...PENDING_REVIEW },
    };
  }

  const expired = validDate(input.expiresAt) && input.expiresAt.getTime() < now.getTime();
  const historical = input.archived === true || expired;
  return {
    source,
    target,
    suggestedDisposition: 'POSTED_RESEARCH_ROLE',
    proposedArtifacts: ['ENTRY_PATHWAY', 'POSTED_OPPORTUNITY'],
    suggestedOpportunityStatus: input.archived === true ? 'ARCHIVED' : expired ? 'CLOSED' : 'OPEN',
    reasons: [historical ? 'HISTORICAL_LISTING' : 'ACTIVE_LISTING'],
    blockers: [],
    review: { ...PENDING_REVIEW },
  };
}

function fellowshipOpportunityReview(
  input: Phase4FellowshipClassificationInput,
  now: Date,
): {
  status?: PostedOpportunityStatus;
  blocker?:
    | 'CONFLICTING_APPLICATION_STATE'
    | 'EXPIRED_APPLICATION_EVIDENCE'
    | 'INVALID_APPLICATION_DEADLINE';
} {
  if (!isPublicHttpUrl(input.applicationLink)) return {};
  if (input.deadline !== undefined && !validDate(input.deadline)) {
    return { blocker: 'INVALID_APPLICATION_DEADLINE' };
  }
  const deadline = validDate(input.deadline) ? input.deadline : undefined;
  const expired = deadline !== undefined && deadline.getTime() < now.getTime();
  if (expired) {
    return { blocker: 'EXPIRED_APPLICATION_EVIDENCE' };
  }
  if (input.isAcceptingApplications === true && input.archived === true) {
    return { blocker: 'CONFLICTING_APPLICATION_STATE' };
  }
  if (input.isAcceptingApplications !== true && !deadline) return {};
  if (input.archived === true) return { status: 'ARCHIVED' };
  if (input.isAcceptingApplications === false) return {};
  return { status: 'OPEN' };
}

function fellowshipProposal(
  input: Phase4FellowshipClassificationInput,
  now: Date,
): Phase4LegacyRecordClassificationProposal {
  const source = { kind: input.sourceKind, id: normalizedSourceId(input.sourceId) };
  const programKind =
    typeof input.programKind === 'string' ? input.programKind.trim().toUpperCase() : '';

  if (input.reviewedResearchRelevance === 'NOT_RESEARCH_RELATED') {
    return {
      source,
      suggestedDisposition: 'ARCHIVE_ONLY',
      proposedArtifacts: [],
      reasons: ['NON_RESEARCH_PROGRAM'],
      blockers: [],
      review: { ...PENDING_REVIEW },
    };
  }

  if (PROGRAM_FORMALIZATION_KINDS.has(programKind as ProgramKind)) {
    const entryMode =
      typeof input.entryMode === 'string' ? input.entryMode.trim().toUpperCase() : '';
    if (['APPLY_TO_PROGRAM', 'APPLY_TO_PROJECT', 'DIRECT_FACULTY_MATCHING'].includes(entryMode)) {
      return {
        source,
        suggestedDisposition: 'MANUAL_REVIEW',
        proposedArtifacts: [],
        reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
        blockers: ['CONFLICTING_PROGRAM_CLASSIFICATION'],
        review: { ...PENDING_REVIEW },
      };
    }
    return {
      source,
      suggestedDisposition: 'FORMALIZATION_ONLY',
      proposedArtifacts: ['FORMALIZATION_SUMMARY'],
      reasons: ['PROGRAM_IS_FORMALIZATION_ONLY'],
      blockers: [],
      review: { ...PENDING_REVIEW },
    };
  }

  if (PROGRAM_PATHWAY_KINDS.has(programKind as ProgramKind)) {
    const entryMode =
      typeof input.entryMode === 'string' ? input.entryMode.trim().toUpperCase() : '';
    if (entryMode === 'SECURE_MENTOR_THEN_APPLY') {
      return {
        source,
        suggestedDisposition: 'FORMALIZATION_ONLY',
        proposedArtifacts: ['FORMALIZATION_SUMMARY'],
        reasons: ['PROGRAM_IS_FORMALIZATION_ONLY', 'MENTOR_REQUIRED_BEFORE_APPLY'],
        blockers: [],
        review: { ...PENDING_REVIEW },
      };
    }
    if (!['APPLY_TO_PROGRAM', 'APPLY_TO_PROJECT', 'DIRECT_FACULTY_MATCHING'].includes(entryMode)) {
      return {
        source,
        suggestedDisposition: 'MANUAL_REVIEW',
        proposedArtifacts: [],
        reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
        blockers: ['UNRESOLVED_PROGRAM_ENTRY_MODE'],
        review: { ...PENDING_REVIEW },
      };
    }
    if (input.reviewedResearchRelevance !== 'RESEARCH_RELATED') {
      return {
        source,
        suggestedDisposition: 'MANUAL_REVIEW',
        proposedArtifacts: [],
        reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
        blockers: ['UNREVIEWED_RESEARCH_RELEVANCE'],
        review: { ...PENDING_REVIEW },
      };
    }

    const opportunityReview = fellowshipOpportunityReview(input, now);
    if (opportunityReview.blocker) {
      return {
        source,
        suggestedDisposition: 'MANUAL_REVIEW',
        proposedArtifacts: [],
        reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
        blockers: [opportunityReview.blocker],
        review: { ...PENDING_REVIEW },
      };
    }
    const opportunityStatus = opportunityReview.status;
    return {
      source,
      suggestedDisposition: 'RESEARCH_PROGRAM_PATHWAY',
      proposedArtifacts: [
        'RESEARCH_ENTITY',
        'ENTRY_PATHWAY',
        ...(opportunityStatus ? (['POSTED_OPPORTUNITY'] as const) : []),
      ],
      ...(opportunityStatus ? { suggestedOpportunityStatus: opportunityStatus } : {}),
      reasons: [
        'PROGRAM_PROVIDES_ENTRY_ROUTE',
        opportunityStatus ? 'REAL_APPLICATION_WINDOW' : 'NO_CURRENT_POSTING_EVIDENCE',
      ],
      blockers: [],
      review: { ...PENDING_REVIEW },
    };
  }

  return {
    source,
    suggestedDisposition: 'MANUAL_REVIEW',
    proposedArtifacts: [],
    reasons: ['UNCLASSIFIED_LEGACY_RECORD'],
    blockers: ['UNRESOLVED_PROGRAM_CLASSIFICATION'],
    review: { ...PENDING_REVIEW },
  };
}

/**
 * Builds review-only Phase 4 classification proposals.
 *
 * Suggestions are never accepted decisions and this module has no persistence
 * capability. A later guarded migration must consume separately reviewed
 * decisions rather than treating these suggestions as writes.
 */
export function planPhase4LegacyRecordClassifications(
  inputs: readonly Phase4LegacyRecordClassificationInput[],
  options: { now: Date },
): Phase4LegacyRecordClassificationPlan {
  if (!Array.isArray(inputs)) throw new TypeError('classification inputs must be an array.');
  if (inputs.length > MAX_PHASE4_CLASSIFICATION_RECORDS) {
    throw new RangeError(
      `classification inputs must contain at most ${MAX_PHASE4_CLASSIFICATION_RECORDS} records.`,
    );
  }
  const now = options?.now;
  if (!validDate(now)) throw new TypeError('now must be a valid Date.');

  const seen = new Set<string>();
  const proposals = inputs.map((input) => {
    if (!input || !['LISTING', 'FELLOWSHIP'].includes(input.sourceKind)) {
      throw new TypeError('sourceKind must be LISTING or FELLOWSHIP.');
    }
    const sourceId = normalizedSourceId(input.sourceId);
    const key = `${input.sourceKind}:${sourceId}`;
    if (seen.has(key)) throw new Error(`Duplicate legacy classification source: ${key}`);
    seen.add(key);
    return input.sourceKind === 'LISTING'
      ? listingProposal(input, now)
      : fellowshipProposal(input, now);
  });

  proposals.sort((left, right) =>
    codePointCompare(
      `${left.source.kind}:${left.source.id}`,
      `${right.source.kind}:${right.source.id}`,
    ),
  );
  return {
    schemaVersion: 1,
    proposals,
  };
}
