/**
 * Append-only audit trail for privileged admin/operator mutations.
 *
 * Writes are fail-soft: a failed audit insert must never break the underlying
 * admin mutation, so record helpers swallow and log errors instead of throwing.
 */
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { sanitizeLogValue } from '../utils/logSanitizer';

const NETID_RE = /^[a-z0-9]{2,12}$/;
const ACTION_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export const MAX_AUDIT_TARGET_ID_LENGTH = 128;
export const MAX_AUDIT_TARGET_TYPE_LENGTH = 64;
export const MAX_AUDIT_SUMMARY_FIELDS = 40;
export const MAX_AUDIT_SUMMARY_FIELD_LENGTH = 64;
export const MAX_AUDIT_SUMMARY_NOTE_LENGTH = 512;
export const MAX_AUDIT_ACTION_LENGTH = 64;
export const MAX_ADMIN_AUDIT_PAGE = 1000;
export const MAX_ADMIN_AUDIT_PAGE_SIZE = 100;

export interface AdminAuditSummary {
  fields?: string[];
  note?: string;
  status?: string;
}

export interface RecordAdminAuditEventInput {
  actorNetid: unknown;
  action: unknown;
  targetType?: unknown;
  targetId?: unknown;
  summary?: AdminAuditSummary;
  metadata?: Record<string, unknown>;
}

export interface AdminAuditEventDto {
  id: string;
  actorNetid: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: AdminAuditSummary | null;
  timestamp: Date | null;
}

export interface AdminAuditQuery {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: unknown;
  pageSize?: unknown;
}

export interface AdminAuditEventsResult {
  events: AdminAuditEventDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const normalizeNetid = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const boundedString = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeSummary = (summary?: AdminAuditSummary): AdminAuditSummary | undefined => {
  if (!summary || typeof summary !== 'object') return undefined;

  const normalized: AdminAuditSummary = {};

  if (Array.isArray(summary.fields)) {
    const fields = summary.fields
      .filter((field): field is string => typeof field === 'string')
      .map((field) => field.trim().slice(0, MAX_AUDIT_SUMMARY_FIELD_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_AUDIT_SUMMARY_FIELDS);
    if (fields.length > 0) normalized.fields = fields;
  }

  const note = boundedString(summary.note, MAX_AUDIT_SUMMARY_NOTE_LENGTH);
  if (note) normalized.note = note;

  const status = boundedString(summary.status, MAX_AUDIT_SUMMARY_FIELD_LENGTH);
  if (status) normalized.status = status;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const recordAdminAuditEvent = async (input: RecordAdminAuditEventInput): Promise<void> => {
  try {
    const actorNetid = normalizeNetid(input.actorNetid);
    const action = boundedString(input.action, MAX_AUDIT_ACTION_LENGTH).toLowerCase();

    if (!NETID_RE.test(actorNetid) || !ACTION_RE.test(action)) {
      return;
    }

    await AdminAuditEvent.create({
      actorNetid,
      action,
      targetType: boundedString(input.targetType, MAX_AUDIT_TARGET_TYPE_LENGTH) || undefined,
      targetId: boundedString(input.targetId, MAX_AUDIT_TARGET_ID_LENGTH) || undefined,
      summary: normalizeSummary(input.summary),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : undefined,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Admin audit: failed to record event:', sanitizeLogValue(error));
  }
};

export const adminAuditEventDto = (event: any): AdminAuditEventDto => ({
  id: typeof event?._id?.toString === 'function' ? event._id.toString() : String(event?._id ?? ''),
  actorNetid: typeof event?.actorNetid === 'string' ? event.actorNetid : '',
  action: typeof event?.action === 'string' ? event.action : '',
  targetType: typeof event?.targetType === 'string' ? event.targetType : '',
  targetId: typeof event?.targetId === 'string' ? event.targetId : '',
  summary:
    event?.summary && typeof event.summary === 'object'
      ? (normalizeSummary(event.summary as AdminAuditSummary) ?? null)
      : null,
  timestamp: event?.timestamp instanceof Date ? event.timestamp : (event?.timestamp ?? null),
});

const clampAuditPagination = (
  page: unknown,
  pageSize: unknown,
): { page: number; pageSize: number } => {
  const toPositiveInteger = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    page: Math.min(MAX_ADMIN_AUDIT_PAGE, toPositiveInteger(page, 1)),
    pageSize: Math.min(MAX_ADMIN_AUDIT_PAGE_SIZE, toPositiveInteger(pageSize, 25)),
  };
};

export const listAdminAuditEvents = async (
  query: AdminAuditQuery = {},
): Promise<AdminAuditEventsResult> => {
  const { page, pageSize } = clampAuditPagination(query.page, query.pageSize);
  const filter: Record<string, unknown> = {};

  const actor = normalizeNetid(query.actor);
  if (actor && NETID_RE.test(actor)) filter.actorNetid = actor;

  const action = boundedString(query.action, MAX_AUDIT_ACTION_LENGTH).toLowerCase();
  if (action && ACTION_RE.test(action)) filter.action = action;

  const targetType = boundedString(query.targetType, MAX_AUDIT_TARGET_TYPE_LENGTH);
  if (targetType) filter.targetType = targetType;

  const targetId = boundedString(query.targetId, MAX_AUDIT_TARGET_ID_LENGTH);
  if (targetId) filter.targetId = targetId;

  const [events, total] = await Promise.all([
    AdminAuditEvent.find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AdminAuditEvent.countDocuments(filter),
  ]);

  return {
    events: events.map(adminAuditEventDto),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};
