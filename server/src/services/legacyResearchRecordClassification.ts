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
  'REAL_APPLICATION_WINDOW',
  'NO_CURRENT_POSTING_EVIDENCE',
  'NON_RESEARCH_PROGRAM',
  'UNCLASSIFIED_LEGACY_RECORD',
] as const;
export type Phase4ClassificationReason = (typeof phase4ClassificationReasons)[number];

export const phase4ClassificationBlockers = [
  'MISSING_RESEARCH_ENTITY',
  'INVALID_RESEARCH_ENTITY_ID',
  'UNCONFIRMED_LISTING',
  'MISSING_LISTING_TYPE',
  'UNSUPPORTED_LISTING_TYPE',
  'UNRESOLVED_PROGRAM_CLASSIFICATION',
] as const;
export type Phase4ClassificationBlocker = (typeof phase4ClassificationBlockers)[number];

export interface Phase4ListingClassificationInput {
  sourceKind: 'LISTING';
  sourceId: string;
  researchEntityId?: string;
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
  researchRelated?: boolean;
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

function researchEntityBlockers(value: unknown): Phase4ClassificationBlocker[] {
  if (value === undefined || value === null || value === '') {
    return ['MISSING_RESEARCH_ENTITY'];
  }
  return validResearchEntityId(value) ? [] : ['INVALID_RESEARCH_ENTITY_ID'];
}

function listingProposal(
  input: Phase4ListingClassificationInput,
  now: Date,
): Phase4LegacyRecordClassificationProposal {
  const source = { kind: input.sourceKind, id: normalizedSourceId(input.sourceId) };
  const entityBlockers = researchEntityBlockers(input.researchEntityId);
  const type = typeof input.type === 'string' ? input.type.trim().toLowerCase() : '';

  if (input.confirmed !== true) {
    return {
      source,
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
    suggestedDisposition: 'POSTED_RESEARCH_ROLE',
    proposedArtifacts: ['ENTRY_PATHWAY', 'POSTED_OPPORTUNITY'],
    suggestedOpportunityStatus: input.archived === true ? 'ARCHIVED' : expired ? 'CLOSED' : 'OPEN',
    reasons: [historical ? 'HISTORICAL_LISTING' : 'ACTIVE_LISTING'],
    blockers: [],
    review: { ...PENDING_REVIEW },
  };
}

function fellowshipOpportunityStatus(
  input: Phase4FellowshipClassificationInput,
  now: Date,
): PostedOpportunityStatus | undefined {
  if (!isPublicHttpUrl(input.applicationLink)) return undefined;
  const deadline = validDate(input.deadline) ? input.deadline : undefined;
  if (input.isAcceptingApplications !== true && !deadline) return undefined;
  if (input.archived === true) return 'ARCHIVED';
  if (input.isAcceptingApplications === true) return 'OPEN';
  if (input.isAcceptingApplications === false) return 'CLOSED';
  return deadline!.getTime() < now.getTime() ? 'CLOSED' : 'OPEN';
}

function fellowshipProposal(
  input: Phase4FellowshipClassificationInput,
  now: Date,
): Phase4LegacyRecordClassificationProposal {
  const source = { kind: input.sourceKind, id: normalizedSourceId(input.sourceId) };
  const programKind =
    typeof input.programKind === 'string' ? input.programKind.trim().toUpperCase() : '';

  if (input.researchRelated === false) {
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
    const opportunityStatus = fellowshipOpportunityStatus(input, now);
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
  options: { now?: Date } = {},
): Phase4LegacyRecordClassificationPlan {
  if (!Array.isArray(inputs)) throw new TypeError('classification inputs must be an array.');
  if (inputs.length > MAX_PHASE4_CLASSIFICATION_RECORDS) {
    throw new RangeError(
      `classification inputs must contain at most ${MAX_PHASE4_CLASSIFICATION_RECORDS} records.`,
    );
  }
  const now = options.now ?? new Date();
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
