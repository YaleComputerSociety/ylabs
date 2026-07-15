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
import mongoose from 'mongoose';
import { AnalyticsEventType, RESEARCH_ENTITY_TYPES, ResearchEntityType } from '../models/analytics';
import { Fellowship, ResearchEntity, User } from '../models/index';
import { getListingModel } from '../db/connections';
import { logEvent } from './analyticsService';
import type { LogEventParams } from './analyticsService';
import {
  listPlanningContextsForResearchEntities,
  PLANNING_CONTEXT_CATEGORIES,
  type PlanningContextCategory,
  type PublicPlanningContext,
} from './planningContextService';

/** The subset of AnalyticsEventType that describes research-surface activity. */
export const RESEARCH_EVENT_TYPES: readonly AnalyticsEventType[] = [
  AnalyticsEventType.RESEARCH_VIEW,
  AnalyticsEventType.PATHWAY_SAVE,
  AnalyticsEventType.WAYS_IN_CLICK,
  AnalyticsEventType.CONTACT_ROUTE_CLICK,
  AnalyticsEventType.SOURCE_LINK_CLICK,
  AnalyticsEventType.RESEARCH_SEARCH,
  AnalyticsEventType.RESEARCH_ENTITY_IMPRESSION,
  AnalyticsEventType.RESEARCH_PROFILE_OPEN,
  AnalyticsEventType.RESEARCH_SOURCE_REVIEW,
  AnalyticsEventType.RESEARCH_FILTER_CHANGE,
  AnalyticsEventType.RESEARCH_SAVE,
  AnalyticsEventType.RESEARCH_COMPARE,
  AnalyticsEventType.RESEARCH_PLAN_UPDATE,
  AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
];

export const RESEARCH_JOURNEY_EVENT_TYPES: readonly AnalyticsEventType[] = [
  AnalyticsEventType.RESEARCH_SEARCH,
  AnalyticsEventType.RESEARCH_ENTITY_IMPRESSION,
  AnalyticsEventType.RESEARCH_PROFILE_OPEN,
  AnalyticsEventType.RESEARCH_SOURCE_REVIEW,
  AnalyticsEventType.RESEARCH_FILTER_CHANGE,
  AnalyticsEventType.RESEARCH_SAVE,
  AnalyticsEventType.RESEARCH_COMPARE,
  AnalyticsEventType.RESEARCH_PLAN_UPDATE,
  AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
];

export const RESEARCH_SEARCH_OUTCOMES = ['results', 'zero_results', 'error'] as const;
export const RESEARCH_RESULT_COUNT_BUCKETS = ['0', '1-5', '6-20', '21-50', '51+'] as const;
export const RESEARCH_SEARCH_KINDS = ['query', 'filtered', 'department'] as const;
export const RESEARCH_FILTER_COUNT_BUCKETS = ['0', '1', '2', '3+'] as const;
export const RESEARCH_IMPRESSION_SURFACES = ['browse', 'search', 'saved_plans'] as const;
export const RESEARCH_POSITION_BUCKETS = ['1-3', '4-10', '11-24', '25+'] as const;
export const RESEARCH_PROFILE_OPEN_SOURCES = ['browse', 'search', 'direct', 'saved_plans'] as const;
export const RESEARCH_SOURCE_CATEGORIES = [
  'entity_website',
  'faculty_profile',
  'orcid',
  'publication',
  'evidence',
  'other',
] as const;
export const RESEARCH_FILTER_OPERATIONS = [
  'apply',
  'remove',
  'clear',
  'panel_open',
  'panel_close',
] as const;
export const RESEARCH_FILTER_KINDS = [
  'school',
  'department',
  'documented_way_in',
  'admin_quality',
  'admin_trust',
] as const;
export const RESEARCH_SAVE_OPERATIONS = ['save', 'remove'] as const;
export const RESEARCH_SAVE_SURFACES = ['profile', 'search', 'saved_plans'] as const;
export const RESEARCH_COMPARE_COUNT_BUCKETS = ['1', '2', '3-4', '5+'] as const;
export const RESEARCH_PLAN_FIELDS = [
  'intent',
  'stage',
  'note_presence',
  'checklist',
  'target_deadline',
  'acted_on_date',
  'follow_up',
] as const;

const JOURNEY_EVENTS_WITHOUT_ENTITY = new Set<AnalyticsEventType>([
  AnalyticsEventType.RESEARCH_SEARCH,
  AnalyticsEventType.RESEARCH_FILTER_CHANGE,
]);
const ANALYTICS_DEDUPE_KEY_RE = /^[A-Za-z0-9:_-]{1,160}$/;

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
  isPlainString(value) && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

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
    case AnalyticsEventType.RESEARCH_SEARCH: {
      out.outcome = oneOf(input.outcome, RESEARCH_SEARCH_OUTCOMES) ?? 'error';
      out.resultCountBucket = oneOf(input.resultCountBucket, RESEARCH_RESULT_COUNT_BUCKETS) ?? '0';
      out.searchKind = oneOf(input.searchKind, RESEARCH_SEARCH_KINDS) ?? 'query';
      out.filterCountBucket = oneOf(input.filterCountBucket, RESEARCH_FILTER_COUNT_BUCKETS) ?? '0';
      break;
    }
    case AnalyticsEventType.RESEARCH_ENTITY_IMPRESSION: {
      out.surface = oneOf(input.surface, RESEARCH_IMPRESSION_SURFACES) ?? 'search';
      out.positionBucket = oneOf(input.positionBucket, RESEARCH_POSITION_BUCKETS) ?? '25+';
      break;
    }
    case AnalyticsEventType.RESEARCH_PROFILE_OPEN: {
      out.source = oneOf(input.source, RESEARCH_PROFILE_OPEN_SOURCES) ?? 'direct';
      break;
    }
    case AnalyticsEventType.RESEARCH_SOURCE_REVIEW: {
      out.sourceCategory = oneOf(input.sourceCategory, RESEARCH_SOURCE_CATEGORIES) ?? 'other';
      break;
    }
    case AnalyticsEventType.RESEARCH_FILTER_CHANGE: {
      out.operation = oneOf(input.operation, RESEARCH_FILTER_OPERATIONS) ?? 'apply';
      out.filter = oneOf(input.filter, RESEARCH_FILTER_KINDS) ?? 'department';
      break;
    }
    case AnalyticsEventType.RESEARCH_SAVE: {
      out.operation = oneOf(input.operation, RESEARCH_SAVE_OPERATIONS) ?? 'save';
      out.surface = oneOf(input.surface, RESEARCH_SAVE_SURFACES) ?? 'profile';
      break;
    }
    case AnalyticsEventType.RESEARCH_COMPARE: {
      out.entityCountBucket = oneOf(input.entityCountBucket, RESEARCH_COMPARE_COUNT_BUCKETS) ?? '1';
      break;
    }
    case AnalyticsEventType.RESEARCH_PLAN_UPDATE: {
      out.field = oneOf(input.field, RESEARCH_PLAN_FIELDS) ?? 'stage';
      break;
    }
    case AnalyticsEventType.RESEARCH_QUALIFIED_ACTION: {
      const actionCategory = oneOf(input.actionCategory, PLANNING_CONTEXT_CATEGORIES);
      if (actionCategory) out.actionCategory = actionCategory;
      break;
    }
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
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (trimmed === '' || trimmed.length > 253) return undefined;
  // A hostname has no scheme, path, whitespace, or '@'.
  if (/[\s/@?#]/.test(trimmed) || trimmed.includes('://')) return undefined;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) return undefined;
  return trimmed;
};

export const isResearchEventType = (value: unknown): value is AnalyticsEventType =>
  isPlainString(value) && (RESEARCH_EVENT_TYPES as readonly string[]).includes(value);

export const isResearchJourneyEventType = (value: unknown): value is AnalyticsEventType =>
  isPlainString(value) && (RESEARCH_JOURNEY_EVENT_TYPES as readonly string[]).includes(value);

export const researchJourneyEventRequiresEntity = (eventType: AnalyticsEventType): boolean =>
  !JOURNEY_EVENTS_WITHOUT_ENTITY.has(eventType);

export const isResearchEntityType = (value: unknown): value is ResearchEntityType =>
  isPlainString(value) && (RESEARCH_ENTITY_TYPES as readonly string[]).includes(value);

export const researchEntityExists = async (
  entityType: ResearchEntityType,
  entityId: string,
): Promise<boolean> => {
  const id = entityId.trim();

  if (entityType === 'profile') {
    return Boolean(await User.exists({ netid: id }));
  }

  if (entityType === 'research_entity') {
    return mongoose.isValidObjectId(id) && Boolean(await ResearchEntity.exists({ _id: id }));
  }

  if (!mongoose.isValidObjectId(id)) {
    return false;
  }

  if (entityType === 'listing') {
    return Boolean(await getListingModel().exists({ _id: id }));
  }

  return Boolean(await Fellowship.exists({ _id: id }));
};

export interface BuildResearchEventInput {
  eventType: AnalyticsEventType;
  netid: string;
  userType: string;
  entityType?: ResearchEntityType;
  entityId?: string;
  payload?: unknown;
  dedupeKey?: string;
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
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: String(input.entityId).slice(0, 128) } : {}),
    ...(metadata ? { metadata } : {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
  };
};

export interface EmitResearchEventInput {
  eventType: unknown;
  entityType: unknown;
  entityId: unknown;
  user?: AnalyticsUser;
  payload?: unknown;
  dedupeKey?: unknown;
}

type PlanningContextResolver = (
  ids: Array<string | mongoose.Types.ObjectId>,
) => Promise<Map<string, PublicPlanningContext>>;

export const emitResearchEvent = async (
  input: EmitResearchEventInput,
  log: ResearchLogFn = logEvent,
  resolvePlanningContexts: PlanningContextResolver = listPlanningContextsForResearchEntities,
): Promise<boolean> => {
  if (!isResearchEventType(input.eventType) || !isNonEmptyString(input.user?.netId)) {
    return false;
  }

  const entityOptional = JOURNEY_EVENTS_WITHOUT_ENTITY.has(input.eventType);
  const hasEntity = isResearchEntityType(input.entityType) && isNonEmptyString(input.entityId);
  if (!entityOptional && !hasEntity) return false;
  if (
    input.dedupeKey !== undefined &&
    !(typeof input.dedupeKey === 'string' && ANALYTICS_DEDUPE_KEY_RE.test(input.dedupeKey))
  )
    return false;

  let payload = input.payload;
  if (input.eventType === AnalyticsEventType.RESEARCH_QUALIFIED_ACTION) {
    if (input.entityType !== 'research_entity' || !isNonEmptyString(input.entityId)) return false;
    const contexts = await resolvePlanningContexts([input.entityId.trim()]);
    const context = contexts.get(input.entityId.trim());
    if (!context) return false;
    const requestedCategory = (input.payload as { actionCategory?: unknown } | undefined)
      ?.actionCategory;
    if (
      requestedCategory !== undefined &&
      requestedCategory !== (context.category as PlanningContextCategory)
    )
      return false;
    payload = { actionCategory: context.category };
  }

  await log(
    buildResearchEvent({
      eventType: input.eventType,
      netid: input.user.netId,
      userType: input.user.userType || 'unknown',
      ...(hasEntity
        ? {
            entityType: input.entityType as ResearchEntityType,
            entityId: (input.entityId as string).trim(),
          }
        : {}),
      payload,
      ...(typeof input.dedupeKey === 'string' ? { dedupeKey: input.dedupeKey } : {}),
    }),
  );

  return true;
};

export const logResearchEventOnSuccess = (
  eventType: AnalyticsEventType,
  entityType: ResearchEntityType,
  getEntityId: (req: Request) => string | undefined = (req) => req.params.id,
  getPayload: (req: Request) => unknown = () => ({ surface: entityType }),
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
          payload: getPayload(req),
        }).catch((err) => console.error(`Error logging ${eventType} event:`, err));
      }

      return originalSend(data);
    };

    next();
  };
};
