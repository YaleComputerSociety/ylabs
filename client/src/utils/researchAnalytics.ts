import axios from './axios';
import { getApiBaseUrl } from './apiBaseUrl';

export type LegacyResearchEventType =
  | 'research_view'
  | 'pathway_save'
  | 'ways_in_click'
  | 'contact_route_click'
  | 'source_link_click';

export const RESEARCH_JOURNEY_EVENT_TYPES = [
  'research_search',
  'research_entity_impression',
  'research_profile_open',
  'research_source_review',
  'research_filter_change',
  'research_save',
  'research_compare',
  'research_plan_update',
  'research_qualified_action',
] as const;

export type ResearchJourneyEventType = (typeof RESEARCH_JOURNEY_EVENT_TYPES)[number];
export type ResearchEventType = LegacyResearchEventType | ResearchJourneyEventType;
export type ResearchEntityType = 'profile' | 'listing' | 'fellowship' | 'research_entity';
export type PlanningContextCategory =
  | 'open_position'
  | 'official_application'
  | 'reviewed_route'
  | 'qualified_participation';

export type ResearchJourneyPayload =
  | {
      outcome: 'results' | 'zero_results' | 'error';
      resultCountBucket: '0' | '1-5' | '6-20' | '21-50' | '51+';
      searchKind: 'query' | 'filtered' | 'department';
      filterCountBucket: '0' | '1' | '2' | '3+';
    }
  | {
      surface: 'browse' | 'search' | 'saved_plans';
      positionBucket: '1-3' | '4-10' | '11-24' | '25+';
    }
  | { source: 'browse' | 'search' | 'direct' | 'saved_plans' }
  | {
      sourceCategory:
        | 'entity_website'
        | 'faculty_profile'
        | 'orcid'
        | 'publication'
        | 'evidence'
        | 'other';
    }
  | {
      operation: 'apply' | 'remove' | 'clear' | 'panel_open' | 'panel_close';
      filter: 'school' | 'department' | 'documented_way_in' | 'admin_quality' | 'admin_trust';
    }
  | { operation: 'save' | 'remove'; surface: 'profile' | 'search' | 'saved_plans' }
  | { entityCountBucket: '1' | '2' | '3-4' | '5+' }
  | {
      field:
        | 'intent'
        | 'stage'
        | 'note_presence'
        | 'checklist'
        | 'target_deadline'
        | 'acted_on_date'
        | 'follow_up';
    }
  | { actionCategory: PlanningContextCategory };

interface TrackResearchEventParams {
  eventType: ResearchEventType;
  entityType?: ResearchEntityType;
  entityId?: string;
  payload?: Record<string, string> | ResearchJourneyPayload;
  dedupeKey?: string;
}

const sentOnceKeys = new Set<string>();
let fallbackInteractionSequence = 0;

export const createResearchAnalyticsInteractionId = (prefix = 'journey'): string => {
  const randomId = globalThis.crypto?.randomUUID?.().replace(/-/g, '');
  if (randomId) return `${prefix}:${randomId}`;
  fallbackInteractionSequence += 1;
  return `${prefix}:${Date.now().toString(36)}:${fallbackInteractionSequence.toString(36)}`;
};

export const researchResultCountBucket = (
  count: number,
): '0' | '1-5' | '6-20' | '21-50' | '51+' => {
  if (count <= 0) return '0';
  if (count <= 5) return '1-5';
  if (count <= 20) return '6-20';
  if (count <= 50) return '21-50';
  return '51+';
};

export const researchPositionBucket = (position: number): '1-3' | '4-10' | '11-24' | '25+' => {
  if (position <= 3) return '1-3';
  if (position <= 10) return '4-10';
  if (position <= 24) return '11-24';
  return '25+';
};

export const researchCountBucket = (count: number): '1' | '2' | '3-4' | '5+' => {
  if (count <= 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  return '5+';
};

type OutgoingResearchEvent = {
  eventType: ResearchEventType;
  entityType?: ResearchEntityType;
  entityId?: string;
  payload?: Record<string, string> | ResearchJourneyPayload;
  dedupeKey?: string;
};

const RESEARCH_EVENT_FLUSH_DELAY_MS = 2000;
const RESEARCH_EVENT_MAX_BATCH = 20;

let eventBuffer: OutgoingResearchEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unloadFlushBound = false;

const buildOutgoingEvent = ({
  eventType,
  entityType,
  entityId,
  payload,
  dedupeKey,
}: TrackResearchEventParams): OutgoingResearchEvent => ({
  eventType,
  ...(entityType ? { entityType } : {}),
  ...(entityId ? { entityId } : {}),
  ...(payload ? { payload } : {}),
  ...(dedupeKey ? { dedupeKey } : {}),
});

const sendResearchEventBatch = async (events: OutgoingResearchEvent[]): Promise<void> => {
  if (events.length === 0) return;
  try {
    await axios.post('/analytics/research/batch', { events }, { withCredentials: true });
  } catch {
    // Analytics is deliberately non-blocking and invisible.
  }
};

const takeBufferedEvents = (): OutgoingResearchEvent[] => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const events = eventBuffer;
  eventBuffer = [];
  return events;
};

/**
 * Flush buffered research analytics immediately. Exposed so tests can assert the
 * batched request deterministically; also called on the size threshold.
 */
export const flushResearchAnalytics = async (): Promise<void> => {
  await sendResearchEventBatch(takeBufferedEvents());
};

const flushResearchAnalyticsViaBeacon = (): void => {
  const events = takeBufferedEvents();
  if (events.length === 0) return;
  const body = JSON.stringify({ events });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(`${getApiBaseUrl()}/analytics/research/batch`, blob)) return;
  }
  void sendResearchEventBatch(events);
};

const bindUnloadFlush = (): void => {
  if (unloadFlushBound || typeof document === 'undefined') return;
  unloadFlushBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushResearchAnalyticsViaBeacon();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushResearchAnalyticsViaBeacon);
  }
};

const scheduleResearchAnalyticsFlush = (): void => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushResearchAnalytics();
  }, RESEARCH_EVENT_FLUSH_DELAY_MS);
};

/**
 * Fire-and-forget analytics. Events are buffered and delivered in batches so
 * ordinary browsing does not emit one request per impression; delivery is
 * guaranteed on the size threshold, a short timer, and tab hide/unload. The
 * promise always resolves so a blocked tracker can never affect interaction.
 */
export const trackResearchEvent = async (params: TrackResearchEventParams): Promise<void> => {
  bindUnloadFlush();
  eventBuffer.push(buildOutgoingEvent(params));
  if (eventBuffer.length >= RESEARCH_EVENT_MAX_BATCH) {
    await flushResearchAnalytics();
    return;
  }
  scheduleResearchAnalyticsFlush();
};

export const trackResearchEventOnce = (
  onceKey: string,
  event: TrackResearchEventParams,
): Promise<void> => {
  if (sentOnceKeys.has(onceKey)) return Promise.resolve();
  sentOnceKeys.add(onceKey);
  return trackResearchEvent({ ...event, dedupeKey: event.dedupeKey || onceKey });
};

export const resetResearchAnalyticsDedupeForTests = (): void => {
  sentOnceKeys.clear();
  fallbackInteractionSequence = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  eventBuffer = [];
};
