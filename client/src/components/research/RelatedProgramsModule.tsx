import { useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';

import ResearchHomeCard from './ResearchHomeCard';
import axios from '../../utils/axios';
import {
  buildGroupedSearchResults,
  type ResearchCluster,
} from '../../utils/researchDiscoveryAdapters';
import {
  normalizeResearchEntitySearchResponse,
  type ResearchEntity,
  type ResearchEntitySearchResponse,
} from '../../types/researchEntity';
import {
  createResearchAnalyticsInteractionId,
  researchPositionBucket,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../../utils/researchAnalytics';

interface RelatedProgramsTopicFilters {
  school?: string[];
  departments?: string[];
  researchAreas?: string[];
}

interface RelatedProgramsModuleProps {
  query: string;
  topicFilters?: RelatedProgramsTopicFilters;
}

interface RelatedProgramsResponse {
  researchEntities: ResearchEntity[];
}

const fetchRelatedPrograms = async (
  query: string,
  topicFilters: RelatedProgramsTopicFilters,
  signal: AbortSignal,
): Promise<ResearchEntity[]> => {
  const response = await axios.post<ResearchEntitySearchResponse>(
    '/research/related-programs',
    { q: query, filters: topicFilters },
    { signal },
  );
  const normalized = normalizeResearchEntitySearchResponse(
    response.data as RelatedProgramsResponse & ResearchEntitySearchResponse,
  );
  return normalized.researchEntities || [];
};

const clustersFromEntities = (entities: ResearchEntity[]): ResearchCluster[] =>
  entities.map(
    (entity) =>
      buildGroupedSearchResults({ query: '', researchEntities: [entity], pathways: [] })
        .clusters[0],
  );

const RelatedProgramsModule = ({ query, topicFilters }: RelatedProgramsModuleProps) => {
  const trimmedQuery = query.trim();
  const filterKey = JSON.stringify({
    school: topicFilters?.school ?? [],
    departments: topicFilters?.departments ?? [],
    researchAreas: topicFilters?.researchAreas ?? [],
  });
  const [entities, setEntities] = useState<ResearchEntity[]>([]);
  const [failed, setFailed] = useState(false);
  const analyticsKeyRef = useRef('');

  useEffect(() => {
    if (!trimmedQuery) {
      setEntities([]);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setFailed(false);

    void (async () => {
      try {
        const results = await fetchRelatedPrograms(
          trimmedQuery,
          JSON.parse(filterKey) as RelatedProgramsTopicFilters,
          controller.signal,
        );
        if (!active || controller.signal.aborted) return;
        analyticsKeyRef.current = createResearchAnalyticsInteractionId('related');
        setEntities(results);
      } catch (error) {
        if (!active || controller.signal.aborted || isCancel(error)) return;
        setEntities([]);
        setFailed(true);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [trimmedQuery, filterKey]);

  const clusters = useMemo(() => clustersFromEntities(entities), [entities]);

  useEffect(() => {
    const analyticsKey = analyticsKeyRef.current;
    if (!analyticsKey) return;
    entities.forEach((entity, index) => {
      if (!entity._id) return;
      void trackResearchEventOnce(`${analyticsKey}:i:${entity._id}`, {
        eventType: 'research_entity_impression',
        entityType: 'research_entity',
        entityId: entity._id,
        payload: {
          surface: 'related_programs',
          positionBucket: researchPositionBucket(index + 1),
        },
      });
    });
  }, [entities]);

  const handleOpen = (cluster: ResearchCluster) => {
    const entityId = cluster.entities.find((entity) => entity._id)?._id;
    if (!entityId) return;
    void trackResearchEvent({
      eventType: 'research_profile_open',
      entityType: 'research_entity',
      entityId,
      payload: { source: 'related_programs' },
    });
  };

  if (!trimmedQuery || failed || clusters.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Related programs and fellowships"
      className="mt-8 border-t border-slate-200 pt-6"
    >
      <div className="mb-3">
        <h2 className="yr-kicker">Related programs &amp; fellowships</h2>
        <p className="mt-1 text-sm text-slate-600">
          Yale programs and fellowships matching your search. Each links to its own page and
          application route.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        {clusters.map((cluster) => (
          <ResearchHomeCard
            key={cluster.id}
            home={cluster}
            onOpen={handleOpen}
            variant="compact"
          />
        ))}
      </div>
    </section>
  );
};

export default RelatedProgramsModule;
