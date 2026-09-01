import { createHash } from 'crypto';
import type { FellowshipCatalogCandidate } from '../scrapers/sources/yaleCollegeFellowshipsOfficeScraper';

export const FELLOWSHIP_REFRESH_MAX_BATCH = 100;
export type FellowshipRefreshTarget = 'beta' | 'prod';

export interface ExistingFellowshipRefreshRecord {
  sourceKey: string;
  sourceFingerprint?: string;
  deadline?: Date | string | null;
  isAcceptingApplications?: boolean;
}

export interface FellowshipRefreshPlanItem {
  candidate: FellowshipCatalogCandidate;
  action: 'create' | 'update' | 'unchanged' | 'review';
  changedFields: string[];
  transition?: 'reopened';
  reviewReason?: string;
}

const JUNK_TITLE =
  /^(?:about|apply|application|contact|find funding|fellowships?|funding|home|learn more|more|read more|resources?)$/i;

export function validateFellowshipRefreshCandidate(
  candidate: FellowshipCatalogCandidate,
): string | undefined {
  const title = candidate.title.trim();
  if (title.length < 5 || title.length > 180 || JUNK_TITLE.test(title)) return 'junk-title';
  if (!candidate.sourceKey.startsWith('yale-college-fellowships-office:'))
    return 'invalid-source-key';
  try {
    const url = new URL(candidate.sourceUrl);
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'yale.edu' || url.hostname.endsWith('.yale.edu'))
    ) {
      return 'non-authoritative-source';
    }
  } catch {
    return 'invalid-source-url';
  }
  if (candidate.deadline && Number.isNaN(candidate.deadline.getTime())) return 'invalid-deadline';
  if (!candidate.deadline) return 'missing-deadline';
  return undefined;
}

function oldDate(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

export function buildFellowshipRefreshPlan(input: {
  candidates: FellowshipCatalogCandidate[];
  existing: ExistingFellowshipRefreshRecord[];
  now?: Date;
  maxBatch?: number;
}): FellowshipRefreshPlanItem[] {
  const maxBatch = input.maxBatch ?? FELLOWSHIP_REFRESH_MAX_BATCH;
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1 || maxBatch > FELLOWSHIP_REFRESH_MAX_BATCH) {
    throw new Error(`max batch must be an integer from 1 through ${FELLOWSHIP_REFRESH_MAX_BATCH}`);
  }
  const now = input.now ?? new Date();
  const existing = new Map(input.existing.map((row) => [row.sourceKey, row]));
  const seen = new Set<string>();
  return input.candidates.slice(0, maxBatch).map((candidate) => {
    if (seen.has(candidate.sourceKey)) {
      return {
        candidate,
        action: 'review',
        changedFields: [],
        reviewReason: 'duplicate-source-key',
      };
    }
    seen.add(candidate.sourceKey);
    const reviewReason = validateFellowshipRefreshCandidate(candidate);
    if (reviewReason) return { candidate, action: 'review', changedFields: [], reviewReason };
    const previous = existing.get(candidate.sourceKey);
    if (!previous) return { candidate, action: 'create', changedFields: ['new-record'] };
    if (previous.sourceFingerprint === candidate.sourceFingerprint) {
      return { candidate, action: 'unchanged', changedFields: [] };
    }
    const changedFields: string[] = ['sourceFingerprint'];
    const previousDeadline = oldDate(previous.deadline);
    const nextDeadline = candidate.deadline?.getTime();
    if (previousDeadline !== nextDeadline) changedFields.push('deadline');
    if (previous.isAcceptingApplications !== candidate.isAcceptingApplications) {
      changedFields.push('isAcceptingApplications');
    }
    const reopened =
      candidate.isAcceptingApplications &&
      Boolean(nextDeadline && nextDeadline >= now.getTime()) &&
      (previous.isAcceptingApplications !== true ||
        Boolean(previousDeadline && previousDeadline < now.getTime()));
    return {
      candidate,
      action: 'update',
      changedFields,
      transition: reopened ? 'reopened' : undefined,
    };
  });
}

export function assertFellowshipRefreshGuards(options: {
  target: string;
  runtimeTarget?: string;
  execute: boolean;
  confirmation?: string;
  restoreToken?: string;
  prodConfirmation?: string;
}): asserts options is typeof options & { target: FellowshipRefreshTarget } {
  if (options.target !== 'beta' && options.target !== 'prod')
    throw new Error('target must be beta or prod');
  if (options.runtimeTarget && options.runtimeTarget !== options.target)
    throw new Error('target does not match runtime environment');
  if (!options.execute) return;
  if (options.confirmation !== `execute-fellowship-refresh-${options.target}`) {
    throw new Error('execute confirmation does not match target');
  }
  if (!options.restoreToken?.trim()) throw new Error('execute requires a backup/restore token');
  if (
    options.target === 'prod' &&
    options.prodConfirmation !== 'confirm-production-fellowship-refresh'
  ) {
    throw new Error('production execute requires the production confirmation');
  }
}

export function fellowshipRefreshAuditToken(restoreToken: string): string {
  return createHash('sha256').update(`fellowship-refresh:${restoreToken}`).digest('hex');
}

export function aggregateFellowshipRefreshPlan(plan: FellowshipRefreshPlanItem[]) {
  const count = (action: FellowshipRefreshPlanItem['action']) =>
    plan.filter((item) => item.action === action).length;
  return {
    discovered: plan.length,
    created: count('create'),
    updated: count('update'),
    unchanged: count('unchanged'),
    reviewRequired: count('review'),
    reopened: plan.filter((item) => item.transition === 'reopened').length,
  };
}
