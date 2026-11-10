/**
 * Export and deletion of the data a signed-in account holds (#4156).
 *
 * One service serves the self-serve routes and the operator script, so a student's own
 * request and an emailed one remove exactly the same rows. Every collection in scope is
 * environment-local and never promoted, so a deletion here is durable in this environment
 * and touches no other.
 */
import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import { Account } from '../models/account';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { AdminGrant } from '../models/adminGrant';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { DeletedAccountEventTally } from '../models/deletedAccountEventTally';
import { EntityCorrectionReport } from '../models/entityCorrectionReport';
import { ResearchPlan } from '../models/researchPlan';
import { CORPUS_ACCOUNT_ID_REFERENCE_FIELDS } from '../scripts/corpusAccountReferences';
import { ConflictError, NotFoundError } from '../utils/errors';
import { escapeRegex } from '../utils/regex';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { revokeAccountSessions } from './accountService';
import { clearAdminGrantCache } from './adminGrantService';
import type { AccountDeletionEnvironment } from '../models/accountDeletionRequest';
import {
  type CrossEnvironmentDeletionOutcome,
  recordCrossEnvironmentDeletionRequest,
  servingDeletionEnvironment,
} from './accountDeletionRequestService';
import {
  deletePostHogPerson,
  type PostHogPersonDeletionOutcome,
} from './posthogPersonDeletionService';

export const ACCOUNT_DATA_EXPORT_SCOPE_VERSION = 1;
export const ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH = 32;
export const ACCOUNT_DATA_DELETION_CONFIRM_PHRASE = 'delete my data';
export const ANALYTICS_EVENT_DELETION_BATCH_SIZE = 500;
export const DELETED_ACCOUNT_REPORTER_TOMBSTONE_PREFIX = 'deleted-';

const OTHER_EVENT_TYPE = 'other';
const KNOWN_EVENT_TYPES = new Set<string>(Object.values(AnalyticsEventType));
const NETID_INPUT_RE = /^[A-Za-z0-9]{2,12}$/;
const NETID_ADMIN_AUDIT_TARGET_TYPES = ['adminGrant', 'account'];

export type AccountDeletionRequester = 'account_holder' | 'operator';

export const ACCOUNT_DELETION_AUDIT_ACTIONS: Record<AccountDeletionRequester, string> = {
  account_holder: 'account.self_delete',
  operator: 'account.operator_delete',
};

const AUDIT_ACTOR_LABELS: Record<AccountDeletionRequester, string> = {
  account_holder: 'accountholder',
  operator: 'operator',
};

export type AuditSubjectHashOutcome = 'recorded' | 'skipped_not_configured';

export interface AccountDataResidue {
  account: number;
  researchPlans: number;
  analyticsEvents: number;
  correctionReports: number;
  adminGrants: number;
}

export interface AccountDataDeletionResult {
  accountFound: boolean;
  deleted: AccountDataResidue;
  postHog: PostHogPersonDeletionOutcome;
  otherEnvironments: CrossEnvironmentDeletionOutcome;
  auditSubjectHash: AuditSubjectHashOutcome;
}

export class AccountDataDeletionBlockedError extends ConflictError {
  constructor(readonly blockers: string[]) {
    super('This account is referenced from directory data, so it cannot be deleted here.');
    this.name = 'AccountDataDeletionBlockedError';
    Object.setPrototypeOf(this, AccountDataDeletionBlockedError.prototype);
  }
}

export const normalizeAccountNetid = (value: unknown): string | null => {
  const netid = typeof value === 'string' ? value.trim() : '';
  return NETID_INPUT_RE.test(netid) ? netid.toLowerCase() : null;
};

const requireNetid = (value: unknown): string => {
  const netid = normalizeAccountNetid(value);
  if (!netid) throw new NotFoundError('Account not found');
  return netid;
};

const storedNetidMatch = (netid: string) => ({
  $regex: `^${escapeRegex(netid)}$`,
  $options: 'i',
});

const analyticsEventsOf = (netid: string) => ({ netid: storedNetidMatch(netid) });
const correctionReportsOf = (netid: string) => ({ 'reporter.netId': storedNetidMatch(netid) });

const adminAuditEventsActedBy = (netid: string) => ({ actorNetid: netid });
const adminAuditEventsTargeting = (netid: string) => ({
  targetType: { $in: NETID_ADMIN_AUDIT_TARGET_TYPES },
  targetId: storedNetidMatch(netid),
});
const adminAuditEventsOf = (netid: string) => ({
  $or: [adminAuditEventsActedBy(netid), adminAuditEventsTargeting(netid)],
});
const activeAdminGrantsOf = (netid: string) => ({ netid, status: 'active' });
const adminGrantsActedOnBy = (netid: string) => ({
  netid: { $ne: netid },
  $or: [{ grantedBy: netid }, { revokedBy: netid }, { 'history.actorNetid': netid }],
});

const auditHmacKey = (env: NodeJS.ProcessEnv): string | null => {
  const key = String(env.ACCOUNT_DELETION_AUDIT_HMAC_KEY || '').trim();
  return key.length >= ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH ? key : null;
};

/**
 * The audit row records that an account was deleted without recording whose (#4156). A
 * keyed hash still lets a maintainer who holds the key answer "was this netid deleted?",
 * which a plain hash would let anyone answer by hashing every netid.
 */
export const accountDeletionAuditSubjectHash = (
  netid: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const key = auditHmacKey(env);
  return key ? createHmac('sha256', key).update(netid).digest('hex') : null;
};

const plainId = (value: unknown): string =>
  value && typeof (value as { toString?: unknown }).toString === 'function' ? String(value) : '';

const withoutStorageKeys = (row: Record<string, unknown>): Record<string, unknown> => {
  const { _id: _ignoredId, __v: _ignoredVersion, ...rest } = row;
  return rest;
};

const exportedAccount = (account: Record<string, any>) => ({
  netid: account.netid,
  email: account.email,
  status: account.status,
  lastLoginAt: account.lastLoginAt ?? null,
  profile: account.profile ?? null,
  productAnalyticsId: account.productAnalyticsId ?? null,
  createdAt: account.createdAt ?? null,
  updatedAt: account.updatedAt ?? null,
});

const exportedResearchPlan = (plan: Record<string, any>) => ({
  id: plainId(plan._id),
  target: { kind: plan.target?.kind, id: plainId(plan.target?.id) },
  stage: plan.stage,
  privateNotes: plan.privateNotes ?? '',
  checklist: plan.checklist ?? [],
  deadlines: plan.deadlines ?? [],
  exportPreferences: plan.exportPreferences ?? null,
  archived: plan.archived === true,
  restorableUntil: plan.restorableUntil ?? null,
  createdAt: plan.createdAt ?? null,
  updatedAt: plan.updatedAt ?? null,
});

const exportedCorrectionReport = (report: Record<string, any>) => ({
  id: plainId(report._id),
  entitySlug: report.entitySlug,
  entityName: report.entitySnapshot?.name ?? '',
  category: report.category,
  note: report.note ?? '',
  status: report.status,
  reviewerNote: report.reviewerNote ?? '',
  reporter: report.reporter ?? null,
  createdAt: report.createdAt ?? null,
  updatedAt: report.updatedAt ?? null,
});

const exportedAdminGrant = (grant: Record<string, any>) => ({
  status: grant.status,
  source: grant.source,
  grantedAt: grant.grantedAt ?? null,
  revokedAt: grant.revokedAt ?? null,
});

const exportedAdminAuditEvent = (netid: string) => (event: Record<string, any>) => ({
  role: event.actorNetid === netid ? 'actor' : 'subject',
  action: event.action,
  targetType: event.targetType ?? null,
  timestamp: event.timestamp ?? null,
});

const exportedAdminGrantActions = (netid: string) => (grant: Record<string, any>) =>
  (Array.isArray(grant.history) ? grant.history : [])
    .filter((entry: Record<string, any>) => entry?.actorNetid === netid)
    .map((entry: Record<string, any>) => ({ action: entry.action, at: entry.at ?? null }));

/**
 * Yields one JSON document in pieces, so an account with thousands of analytics events
 * is streamed from a cursor rather than held in memory.
 */
export async function* accountDataExportChunks(
  netidInput: unknown,
  now: Date = new Date(),
): AsyncGenerator<string> {
  const netid = requireNetid(netidInput);
  const account = (await Account.findOne({ netid }).lean()) as Record<string, any> | null;
  if (!account) throw new NotFoundError('Account not found');

  const [plans, reports, grants, auditEvents, grantsActedOn] = await Promise.all([
    ResearchPlan.find({ accountId: account._id })
      .select('+privateNotes +checklist +deadlines')
      .sort({ createdAt: 1 })
      .lean(),
    EntityCorrectionReport.find(correctionReportsOf(netid)).sort({ createdAt: 1 }).lean(),
    AdminGrant.find({ netid }).sort({ grantedAt: 1 }).lean(),
    AdminAuditEvent.find(adminAuditEventsOf(netid)).sort({ timestamp: 1, _id: 1 }).lean(),
    AdminGrant.find(adminGrantsActedOnBy(netid)).select('history').lean(),
  ]);

  yield `{"scopeVersion":${ACCOUNT_DATA_EXPORT_SCOPE_VERSION},"generatedAt":${JSON.stringify(now.toISOString())}`;
  yield `,"account":${JSON.stringify(exportedAccount(account))}`;
  yield `,"researchPlans":${JSON.stringify((plans as Record<string, any>[]).map(exportedResearchPlan))}`;
  yield `,"correctionReports":${JSON.stringify((reports as Record<string, any>[]).map(exportedCorrectionReport))}`;
  yield `,"adminGrants":${JSON.stringify((grants as Record<string, any>[]).map(exportedAdminGrant))}`;
  yield `,"adminAuditEvents":${JSON.stringify((auditEvents as Record<string, any>[]).map(exportedAdminAuditEvent(netid)))}`;
  yield `,"adminGrantActions":${JSON.stringify((grantsActedOn as Record<string, any>[]).flatMap(exportedAdminGrantActions(netid)))}`;
  yield ',"analyticsEvents":[';
  let first = true;
  for await (const event of AnalyticsEvent.find(analyticsEventsOf(netid))
    .sort({ timestamp: 1, _id: 1 })
    .lean()
    .cursor()) {
    yield `${first ? '' : ','}${JSON.stringify(withoutStorageKeys(event as Record<string, unknown>))}`;
    first = false;
  }
  yield ']}';
}

export const readAccountDataResidue = async (netidInput: unknown): Promise<AccountDataResidue> => {
  const netid = requireNetid(netidInput);
  const account = (await Account.findOne({ netid }).select('_id').lean()) as {
    _id: mongoose.Types.ObjectId;
  } | null;
  const [researchPlans, analyticsEvents, correctionReports, adminGrants] = await Promise.all([
    account ? ResearchPlan.countDocuments({ accountId: account._id }) : Promise.resolve(0),
    AnalyticsEvent.countDocuments(analyticsEventsOf(netid)),
    EntityCorrectionReport.countDocuments(correctionReportsOf(netid)),
    AdminGrant.countDocuments(activeAdminGrantsOf(netid)),
  ]);
  return {
    account: account ? 1 : 0,
    researchPlans,
    analyticsEvents,
    correctionReports,
    adminGrants,
  };
};

const corpusReferenceBlockers = async (accountId: mongoose.Types.ObjectId): Promise<string[]> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo is not connected');
  const counts = await Promise.all(
    CORPUS_ACCOUNT_ID_REFERENCE_FIELDS.map(async ({ collection, field }) => ({
      collection,
      field,
      count: await db.collection(collection).countDocuments({ [field]: accountId }),
    })),
  );
  return counts
    .filter(({ count }) => count > 0)
    .map(
      ({ collection, field, count }) => `${count} ${collection} rows hold this account in ${field}`,
    );
};

const tallyMonth = (timestamp: unknown, now: Date): string => {
  const date = timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) ? timestamp : now;
  return date.toISOString().slice(0, 7);
};

const tallyEventType = (eventType: unknown): string =>
  typeof eventType === 'string' && KNOWN_EVENT_TYPES.has(eventType) ? eventType : OTHER_EVENT_TYPE;

class AnalyticsEventBatchChangedError extends Error {}

/**
 * Folds the events into month-and-type counts and deletes them in the same transaction, a
 * batch at a time, so a retry after a failure never counts an event twice and never
 * deletes one it did not count.
 */
const foldAndDeleteAnalyticsEvents = async (netid: string, now: Date): Promise<number> => {
  let deleted = 0;
  for (;;) {
    const batch = (await AnalyticsEvent.find(analyticsEventsOf(netid))
      .select('_id eventType timestamp')
      .limit(ANALYTICS_EVENT_DELETION_BATCH_SIZE)
      .lean()) as Array<{ _id: mongoose.Types.ObjectId; eventType?: unknown; timestamp?: unknown }>;
    if (batch.length === 0) return deleted;

    const counts = new Map<string, { month: string; eventType: string; count: number }>();
    for (const event of batch) {
      const month = tallyMonth(event.timestamp, now);
      const eventType = tallyEventType(event.eventType);
      const key = `${month}|${eventType}`;
      const entry = counts.get(key) ?? { month, eventType, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }

    try {
      await mongoose.connection.transaction(async (session) => {
        const { deletedCount } = await AnalyticsEvent.deleteMany(
          { _id: { $in: batch.map((event) => event._id) } },
          { session },
        );
        if (deletedCount !== batch.length) throw new AnalyticsEventBatchChangedError();
        await DeletedAccountEventTally.bulkWrite(
          [...counts.values()].map(({ month, eventType, count }) => ({
            updateOne: {
              filter: { month, eventType },
              update: { $inc: { count } },
              upsert: true,
            },
          })),
          { session },
        );
      });
    } catch (error) {
      if (error instanceof AnalyticsEventBatchChangedError) continue;
      throw error;
    }
    deleted += batch.length;
  }
};

/**
 * A correction is evidence about a public row, so the report stays and only the reporter
 * is replaced (#4156). The tombstone is unique per report, which keeps the unique index on
 * entity, category and reporter satisfiable while two tombstoned reports are unreviewed.
 */
const tombstoneCorrectionReports = async (netid: string): Promise<number> => {
  const reports = (await EntityCorrectionReport.find(correctionReportsOf(netid))
    .select('_id')
    .lean()) as Array<{ _id: mongoose.Types.ObjectId }>;
  if (reports.length === 0) return 0;
  await EntityCorrectionReport.bulkWrite(
    reports.map(({ _id }) => ({
      updateOne: {
        filter: { _id },
        update: {
          $set: {
            reporter: {
              netId: `${DELETED_ACCOUNT_REPORTER_TOMBSTONE_PREFIX}${plainId(_id)}`,
              email: '',
              name: '',
              userType: 'unknown',
              role: 'other',
            },
          },
        },
      },
    })),
  );
  return reports.length;
};

const revokeAdminGrantsOnDeletion = async (
  netid: string,
  requester: AccountDeletionRequester,
  now: Date,
): Promise<number> => {
  const actorNetid = AUDIT_ACTOR_LABELS[requester];
  const note = 'Account deleted';
  const { modifiedCount } = await AdminGrant.updateMany(activeAdminGrantsOf(netid), {
    $set: { status: 'revoked', revokedBy: actorNetid, revokedAt: now, revokeNote: note },
    $push: { history: { action: 'revoked', actorNetid, note, at: now } },
  });
  return modifiedCount;
};

const recordDeletionAudit = async (
  requester: AccountDeletionRequester,
  subjectHash: string | null,
  result: Omit<AccountDataDeletionResult, 'auditSubjectHash'>,
): Promise<void> => {
  try {
    await AdminAuditEvent.create({
      actorNetid: AUDIT_ACTOR_LABELS[requester],
      action: ACCOUNT_DELETION_AUDIT_ACTIONS[requester],
      targetType: 'account',
      targetId: subjectHash ?? undefined,
      summary: { status: 'deleted' },
      metadata: {
        deleted: result.deleted,
        postHog: result.postHog,
        otherEnvironments: result.otherEnvironments,
        subjectHash: subjectHash ? 'hmac-sha256' : 'not_configured',
      },
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Account deletion audit: failed to record event:', sanitizeLogValue(error));
  }
};

/**
 * Deletes everything in scope for one netid. Sessions are ended first, so another tab
 * stops writing events, and the account goes last, so a failure part way leaves an
 * account the holder can sign in to and retry from; every step is safe to repeat. PostHog
 * is asked before the account goes because the account holds the only copy of the id it
 * knows the student by. The request that carries the deletion to the other environments is
 * recorded before the account goes too, so a failure there is retried rather than lost.
 */
export const deleteAccountData = async (
  netidInput: unknown,
  {
    requester,
    env = process.env,
    now = new Date(),
    environment = servingDeletionEnvironment(),
    requestOtherEnvironments = true,
  }: {
    requester: AccountDeletionRequester;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    environment?: AccountDeletionEnvironment | null;
    requestOtherEnvironments?: boolean;
  },
): Promise<AccountDataDeletionResult> => {
  const netid = requireNetid(netidInput);
  const account = (await Account.findOne({ netid }).select('_id productAnalyticsId').lean()) as {
    _id: mongoose.Types.ObjectId;
    productAnalyticsId?: unknown;
  } | null;

  if (account) {
    const blockers = await corpusReferenceBlockers(account._id);
    if (blockers.length > 0) throw new AccountDataDeletionBlockedError(blockers);
    await revokeAccountSessions(netid);
  }

  const researchPlans = account
    ? (await ResearchPlan.deleteMany({ accountId: account._id })).deletedCount
    : 0;
  const analyticsEvents = await foldAndDeleteAnalyticsEvents(netid, now);
  const correctionReports = await tombstoneCorrectionReports(netid);
  const adminGrants = await revokeAdminGrantsOnDeletion(netid, requester, now);
  if (adminGrants > 0) clearAdminGrantCache();
  const postHog = await deletePostHogPerson(account?.productAnalyticsId, env);
  const subjectHash = accountDeletionAuditSubjectHash(netid, env);
  const otherEnvironments = requestOtherEnvironments
    ? await recordCrossEnvironmentDeletionRequest({
        subjectHash,
        sourceEnvironment: environment,
        requester,
        now,
      })
    : 'not_requested';
  const accountDeleted = account ? (await Account.deleteOne({ _id: account._id })).deletedCount : 0;

  const result = {
    accountFound: Boolean(account),
    deleted: {
      account: accountDeleted,
      researchPlans,
      analyticsEvents,
      correctionReports,
      adminGrants,
    },
    postHog,
    otherEnvironments,
  };
  await recordDeletionAudit(requester, subjectHash, result);
  return { ...result, auditSubjectHash: subjectHash ? 'recorded' : 'skipped_not_configured' };
};
