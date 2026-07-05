import axios from './axios';

export type ResearchEventType =
  | 'research_view'
  | 'pathway_save'
  | 'ways_in_click'
  | 'contact_route_click'
  | 'source_link_click';

export type ResearchEntityType = 'profile' | 'listing' | 'fellowship';

interface TrackResearchEventParams {
  eventType: ResearchEventType;
  entityType: ResearchEntityType;
  entityId: string;
  payload?: Record<string, string>;
}

export const trackResearchEvent = ({
  eventType,
  entityType,
  entityId,
  payload,
}: TrackResearchEventParams) => {
  axios
    .post(
      '/analytics/research',
      {
        eventType,
        entityType,
        entityId,
        payload,
      },
      { withCredentials: true },
    )
    .catch(() => undefined);
};
