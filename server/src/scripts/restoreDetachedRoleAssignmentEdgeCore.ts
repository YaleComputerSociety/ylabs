import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS } from '../models/roleAssignment';
import { looksLikeYaleNetid } from '../utils/yaleNetid';

export type DetachmentDecider = 'owner' | 'stage-or-agent' | 'unattributed';

export type DetachedRoleEdgeRestoreRefusal =
  | 'edge-not-found'
  | 'edge-not-archived-as-disputed'
  | 'person-does-not-match-expected'
  | 'target-does-not-match-expected'
  | 'person-does-not-resolve'
  | 'person-is-archived'
  | 'target-does-not-resolve'
  | 'detachment-decided-by-owner'
  | 'detachment-decider-unattributed'
  | 'live-twin-edge-exists'
  | 'unfold-audit-not-found'
  | 'unfold-audit-names-another-shell'
  | 'edge-not-fold-archived-by-that-unfold'
  | 'unfold-no-longer-stands';

export interface UnfoldAuditTie {
  auditFound: boolean;
  auditShellId: string;
  foldArchivedEdgeIds: readonly string[];
  shellStillUnfolded: boolean;
  isLatestUnfoldOfShell: boolean;
}

export interface DetachedRoleEdgeReviewRecord {
  archived?: unknown;
  reviewStatus?: unknown;
  reviewNotes?: unknown;
  reviewedBy?: unknown;
  reviewedByAgent?: unknown;
  personId?: unknown;
  target?: { kind?: unknown; id?: unknown } | null;
}

export interface DetachedRoleEdgeRestoreInputs {
  edge: DetachedRoleEdgeReviewRecord | null;
  person: { archived?: unknown } | null;
  targetResolves: boolean;
  liveTwinEdgeExists: boolean;
  expectedPersonId?: string;
  expectedTargetId?: string;
  edgeId?: string;
  unfoldTie?: UnfoldAuditTie;
}

export interface DetachedRoleEdgeRestorePlan {
  decider?: DetachmentDecider;
  refusal: DetachedRoleEdgeRestoreRefusal | null;
}

const OWNER_OR_OPERATOR_WORD = /\b(owner|operator)\b/i;
const REPAIR_ISSUE_CITATION = /\(#\d+[^)]*\)/;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const idText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).toLowerCase();

export function classifyDetachmentDecider(edge: DetachedRoleEdgeReviewRecord): DetachmentDecider {
  const note = text(edge.reviewNotes);
  const reviewer = text(edge.reviewedBy);
  if (OWNER_OR_OPERATOR_WORD.test(note) || OWNER_OR_OPERATOR_WORD.test(reviewer)) return 'owner';
  if (reviewer) {
    return edge.reviewedByAgent === true && !looksLikeYaleNetid(reviewer)
      ? 'stage-or-agent'
      : 'owner';
  }
  return REPAIR_ISSUE_CITATION.test(note) ? 'stage-or-agent' : 'unattributed';
}

export const isArchivedAsDisputed = (edge: DetachedRoleEdgeReviewRecord): boolean =>
  edge.archived === true && edge.reviewStatus === DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS;

export const isArchivedByFold = (edge: DetachedRoleEdgeReviewRecord): boolean =>
  edge.archived === true &&
  edge.reviewStatus !== DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS &&
  !text(edge.reviewNotes) &&
  !text(edge.reviewedBy);

function unfoldTieRefusal(
  edge: DetachedRoleEdgeReviewRecord,
  edgeId: string,
  tie: UnfoldAuditTie,
): DetachedRoleEdgeRestoreRefusal | null {
  if (!tie.auditFound) return 'unfold-audit-not-found';
  if (idText(tie.auditShellId) !== idText(edge.personId)) return 'unfold-audit-names-another-shell';
  if (!isArchivedByFold(edge) || !tie.foldArchivedEdgeIds.map(idText).includes(idText(edgeId))) {
    return 'edge-not-fold-archived-by-that-unfold';
  }
  if (!tie.shellStillUnfolded || !tie.isLatestUnfoldOfShell) return 'unfold-no-longer-stands';
  return null;
}

export function planDetachedRoleEdgeRestore(
  input: DetachedRoleEdgeRestoreInputs,
): DetachedRoleEdgeRestorePlan {
  const { edge } = input;
  if (!edge) return { refusal: 'edge-not-found' };
  if (input.unfoldTie) {
    const tieRefusal = unfoldTieRefusal(edge, input.edgeId ?? '', input.unfoldTie);
    if (tieRefusal) return { refusal: tieRefusal };
  }
  const decider = input.unfoldTie ? 'stage-or-agent' : classifyDetachmentDecider(edge);
  const refuse = (refusal: DetachedRoleEdgeRestoreRefusal) => ({ decider, refusal });
  if (!input.unfoldTie && !isArchivedAsDisputed(edge)) {
    return refuse('edge-not-archived-as-disputed');
  }
  if (input.expectedPersonId && idText(edge.personId) !== idText(input.expectedPersonId)) {
    return refuse('person-does-not-match-expected');
  }
  if (input.expectedTargetId && idText(edge.target?.id) !== idText(input.expectedTargetId)) {
    return refuse('target-does-not-match-expected');
  }
  if (!input.person) return refuse('person-does-not-resolve');
  if (input.person.archived === true) return refuse('person-is-archived');
  if (!input.targetResolves) return refuse('target-does-not-resolve');
  if (decider === 'owner') return refuse('detachment-decided-by-owner');
  if (decider === 'unattributed') return refuse('detachment-decider-unattributed');
  if (input.liveTwinEdgeExists) return refuse('live-twin-edge-exists');
  return { decider, refusal: null };
}
