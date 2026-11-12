import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS } from '../models/roleAssignment';
import { isAuditableActor } from '../services/adminAuditService';

export const UNFOLD_SHELL_SCRIPT = 'researchers:unfold-shell';
export const UNFOLD_SHELL_AUDIT_ACTION = 'researcher.unfold_shell';
export const UNFOLD_SHELL_AUDIT_TARGET_TYPE = 'researcher';

export type ResearcherShellUnfoldRefusal =
  | 'shell-not-found'
  | 'shell-not-folded'
  | 'shell-not-archived'
  | 'shell-refolded-after-unfold'
  | 'survivor-does-not-match-expected'
  | 'survivor-not-found'
  | 'survivor-was-itself-folded'
  | 'survivor-is-archived';

export interface UnfoldResearcherRecord {
  _id?: unknown;
  archived?: unknown;
  dedupedIntoResearcherId?: unknown;
  dedupedAt?: unknown;
}

export interface PriorUnfoldAudit {
  id: string;
  timestamp: Date;
}

export interface ResearcherShellUnfoldInputs {
  shell: UnfoldResearcherRecord | null;
  survivor: UnfoldResearcherRecord | null;
  priorUnfolds: ReadonlyArray<PriorUnfoldAudit>;
  expectedSurvivorId?: string;
}

export type ResearcherShellUnfoldPlan =
  | { kind: 'refuse'; refusal: ResearcherShellUnfoldRefusal }
  | { kind: 'already-unfolded'; auditId: string }
  | { kind: 'unfold'; survivorId: string };

const idText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).toLowerCase();

const latest = (audits: ReadonlyArray<PriorUnfoldAudit>): PriorUnfoldAudit | undefined =>
  [...audits].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())[0];

export function planResearcherShellUnfold(
  input: ResearcherShellUnfoldInputs,
): ResearcherShellUnfoldPlan {
  const refuse = (refusal: ResearcherShellUnfoldRefusal) => ({ kind: 'refuse' as const, refusal });
  const { shell, survivor } = input;
  if (!shell) return refuse('shell-not-found');
  const lastUnfold = latest(input.priorUnfolds);
  const survivorId = idText(shell.dedupedIntoResearcherId);
  if (!survivorId) {
    if (lastUnfold && shell.archived !== true) {
      return { kind: 'already-unfolded', auditId: lastUnfold.id };
    }
    return refuse('shell-not-folded');
  }
  if (lastUnfold) return refuse('shell-refolded-after-unfold');
  if (shell.archived !== true) return refuse('shell-not-archived');
  if (input.expectedSurvivorId && survivorId !== idText(input.expectedSurvivorId)) {
    return refuse('survivor-does-not-match-expected');
  }
  if (!survivor) return refuse('survivor-not-found');
  if (idText(survivor.dedupedIntoResearcherId)) return refuse('survivor-was-itself-folded');
  if (survivor.archived === true) return refuse('survivor-is-archived');
  return { kind: 'unfold', survivorId };
}

export interface UnfoldEdgeRecord {
  _id?: unknown;
  personId?: unknown;
  target?: { kind?: unknown; id?: unknown } | null;
  role?: unknown;
  archived?: unknown;
  reviewStatus?: unknown;
  reviewNotes?: unknown;
}

const edgeKey = (edge: UnfoldEdgeRecord): string =>
  [idText(edge.target?.kind), idText(edge.target?.id), idText(edge.role)].join('::');

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

export function foldArchivedShellEdgeIds(
  shellEdges: ReadonlyArray<UnfoldEdgeRecord>,
  survivorEdges: ReadonlyArray<UnfoldEdgeRecord>,
): string[] {
  const survivorKeys = new Set(survivorEdges.map(edgeKey));
  return shellEdges
    .filter(
      (edge) =>
        edge.archived === true &&
        edge.reviewStatus !== DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS &&
        !hasText(edge.reviewNotes) &&
        survivorKeys.has(edgeKey(edge)),
    )
    .map((edge) => idText(edge._id));
}

export function auditActorFor(raw: string | undefined): string | undefined {
  const actor = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!actor) return undefined;
  if (isAuditableActor(actor)) return actor;
  throw new Error('--actor must be the operator netid or an agent identifier such as agent:<name>');
}

export function resolveAuditActor(
  explicitActor: string | undefined,
  envOwner: string | undefined,
  apply: boolean,
): string | undefined {
  if (explicitActor !== undefined || apply) return auditActorFor(explicitActor ?? envOwner);
  try {
    return auditActorFor(envOwner);
  } catch {
    return undefined;
  }
}
