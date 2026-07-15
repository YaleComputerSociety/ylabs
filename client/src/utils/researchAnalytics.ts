import axios from './axios';

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

/**
 * Fire-and-forget analytics. The promise always resolves so a blocked tracker,
 * offline browser, or server failure can never affect the student interaction.
 */
export const trackResearchEvent = async ({
  eventType,
  entityType,
  entityId,
  payload,
  dedupeKey,
}: TrackResearchEventParams): Promise<void> => {
  try {
    await axios.post(
      '/analytics/research',
      {
        eventType,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(payload ? { payload } : {}),
        ...(dedupeKey ? { dedupeKey } : {}),
      },
      { withCredentials: true },
    );
  } catch {
    // Analytics is deliberately non-blocking and invisible.
  }
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
};
