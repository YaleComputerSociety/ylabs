/**
 * Pure helpers for the research-surface analytics events.
 *
 * These functions build and sanitize the analytics payloads for the canonical
 * research product surfaces (profile / listing / fellowship views and their
 * interaction affordances). They are deliberately side-effect free so the event
 * shape and, critically, the privacy guarantees can be unit tested without a
 * database or an Express request. The route/controller layer calls
 * {@link buildResearchEvent} and hands the result to `analyticsService.logEvent`.
 *
 * Privacy contract: raw contact addresses (emails, phone numbers) and full
 * source URLs are NEVER persisted. Contact clicks are reduced to a coarse
 * method category; source clicks are reduced to a category plus the bare
 * hostname (no path, query, or fragment, which can carry identifying tokens).
 */
import { Request, Response, NextFunction } from 'express';
import { AnalyticsEventType, RESEARCH_ENTITY_TYPES, ResearchEntityType } from '../models/analytics';
import { logEvent } from './analyticsService';
import type { LogEventParams } from './analyticsService';

/** The subset of AnalyticsEventType that describes research-surface activity. */
export const RESEARCH_EVENT_TYPES: readonly AnalyticsEventType[] = [
  AnalyticsEventType.RESEARCH_VIEW,
  AnalyticsEventType.PATHWAY_SAVE,
  AnalyticsEventType.WAYS_IN_CLICK,
  AnalyticsEventType.CONTACT_ROUTE_CLICK,
  AnalyticsEventType.SOURCE_LINK_CLICK,
];

/** Allowed coarse categories for a contact-route click. Never the address. */
export const CONTACT_METHODS = ['email', 'phone', 'website', 'directory', 'other'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/** Allowed coarse categories for a source-link click. */
export const SOURCE_CATEGORIES = [
  'coursetable',
  'publication',
  'lab_website',
  'directory',
  'profile',
  'external',
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

/** Allowed "way in" / best-next-step affordance kinds. */
export const WAYS_IN_KINDS = [
  'best_next_step',
  'apply',
  'email_intro',
  'view_listings',
  'view_publications',
  'view_courses',
  'other',
] as const;
export type WaysInKind = (typeof WAYS_IN_KINDS)[number];

/** Allowed pathway/save actions and stages (kanban-style tracking). */
export const PATHWAY_ACTIONS = ['save', 'unsave', 'stage_change'] as const;
export type PathwayAction = (typeof PATHWAY_ACTIONS)[number];

const MAX_LABEL_LENGTH = 80;
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE_REGEX = /:\/\/|www\.|\.[a-z]{2,}(?:[/?#]|$)/i;

const isPlainString = (value: unknown): value is string => typeof value === 'string';

/** Coerce to a trimmed, length-capped string, or undefined if empty/invalid. */
const cleanLabel = (value: unknown): string | undefined => {
  if (!isPlainString(value)) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  // Reject anything that carries a contact address or a URL. These are the
  // fields most likely to smuggle in private data through a free-text label.
  if (EMAIL_REGEX.test(trimmed) || URL_LIKE_REGEX.test(trimmed)) return undefined;
  return trimmed.slice(0, MAX_LABEL_LENGTH);
};

/** Pick a value only if it is one of the allowed enum members. */
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  isPlainString(value) && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

/**
 * Extract only the bare hostname from a raw URL. Returns undefined if the value
 * cannot be parsed as an http(s) URL. Path, query, and fragment are discarded
 * because they can contain identifying tokens.
 */
export const extractHostname = (value: unknown): string | undefined => {
  if (!isPlainString(value)) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.hostname.replace(/^www\./, '').toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reduce an arbitrary client-supplied payload to the privacy-safe metadata we
 * are willing to persist for a given research event type. Unknown keys are
 * dropped; contact addresses and source URLs never survive.
 */
export const sanitizeResearchPayload = (
  eventType: AnalyticsEventType,
  raw: unknown,
): Record<string, string> | undefined => {
  const input: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};

  switch (eventType) {
    case AnalyticsEventType.CONTACT_ROUTE_CLICK: {
      const method = oneOf(input.contactMethod ?? input.method, CONTACT_METHODS) ?? 'other';
      out.contactMethod = method;
      break;
    }
    case AnalyticsEventType.SOURCE_LINK_CLICK: {
      out.sourceCategory =
        oneOf(input.sourceCategory ?? input.category, SOURCE_CATEGORIES) ?? 'external';
      // Accept an explicit hostname, otherwise derive one from a raw url; either
      // way only the bare host is ever stored.
      const host = extractHostname(input.url) ?? cleanHost(input.sourceHost ?? input.host);
      if (host) out.sourceHost = host;
      break;
    }
    case AnalyticsEventType.WAYS_IN_CLICK: {
      out.waysInKind = oneOf(input.waysInKind ?? input.kind, WAYS_IN_KINDS) ?? 'other';
      const label = cleanLabel(input.label);
      if (label) out.label = label;
      break;
    }
    case AnalyticsEventType.PATHWAY_SAVE: {
      out.action = oneOf(input.action, PATHWAY_ACTIONS) ?? 'save';
      const stage = cleanLabel(input.stage);
      if (stage) out.stage = stage;
      break;
    }
    case AnalyticsEventType.RESEARCH_VIEW:
    default: {
      const surface = cleanLabel(input.surface);
      if (surface) out.surface = surface;
      break;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
};

/** A hostname supplied directly (not a full URL): validate it is host-shaped. */
const cleanHost = (value: unknown): string | undefined => {
  if (!isPlainString(value)) return undefined;
  const trimmed = value.trim().toLowerCase().replace(/^www\./, '');
  if (trimmed === '' || trimmed.length > 253) return undefined;
  // A hostname has no scheme, path, whitespace, or '@'.
  if (/[\s/@?#]/.test(trimmed) || trimmed.includes('://')) return undefined;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) return undefined;
  return trimmed;
};

export const isResearchEventType = (value: unknown): value is AnalyticsEventType =>
  isPlainString(value) && (RESEARCH_EVENT_TYPES as readonly string[]).includes(value);

export const isResearchEntityType = (value: unknown): value is ResearchEntityType =>
  isPlainString(value) && (RESEARCH_ENTITY_TYPES as readonly string[]).includes(value);

export interface BuildResearchEventInput {
  eventType: AnalyticsEventType;
  netid: string;
  userType: string;
  entityType: ResearchEntityType;
  entityId: string;
  payload?: unknown;
}

type AnalyticsUser = { netId?: string; userType?: string };
type ResearchLogFn = (params: LogEventParams) => Promise<void> | void;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Build a fully-sanitized {@link LogEventParams} for a research-surface event.
 * The result carries only non-private data and is safe to persist as-is.
 */
export const buildResearchEvent = (input: BuildResearchEventInput): LogEventParams => {
  const metadata = sanitizeResearchPayload(input.eventType, input.payload);
  return {
    eventType: input.eventType,
    netid: input.netid,
    userType: input.userType,
    entityType: input.entityType,
    entityId: String(input.entityId).slice(0, 128),
    ...(metadata ? { metadata } : {}),
  };
};

export interface EmitResearchEventInput {
  eventType: unknown;
  entityType: unknown;
  entityId: unknown;
  user?: AnalyticsUser;
  payload?: unknown;
}

export const emitResearchEvent = async (
  input: EmitResearchEventInput,
  log: ResearchLogFn = logEvent,
): Promise<boolean> => {
  if (
    !isResearchEventType(input.eventType) ||
    !isResearchEntityType(input.entityType) ||
    !isNonEmptyString(input.entityId) ||
    !isNonEmptyString(input.user?.netId)
  ) {
    return false;
  }

  await log(
    buildResearchEvent({
      eventType: input.eventType,
      netid: input.user.netId,
      userType: input.user.userType || 'unknown',
      entityType: input.entityType,
      entityId: input.entityId.trim(),
      payload: input.payload,
    }),
  );

  return true;
};

export const logResearchEventOnSuccess = (
  eventType: AnalyticsEventType,
  entityType: ResearchEntityType,
  getEntityId: (req: Request) => string | undefined = (req) => req.params.id,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        emitResearchEvent({
          eventType,
          entityType,
          entityId: getEntityId(req),
          user: req.user as AnalyticsUser | undefined,
          payload: { surface: entityType },
        }).catch((err) => console.error(`Error logging ${eventType} event:`, err));
      }

      return originalSend(data);
    };

    next();
  };
};
