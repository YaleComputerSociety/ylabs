import { useId } from 'react';

import ResearchHomeCard from './ResearchHomeCard';
import type { ResearchCluster } from '../../utils/researchDiscoveryAdapters';

export type MoreTopicResultsAccessFilter = 'hostsUndergrads' | 'welcomesUndergrads';

export const MORE_TOPIC_RESULTS_HEADING = 'More research on this topic';

export const MORE_TOPIC_RESULTS_NOTES: Record<MoreTopicResultsAccessFilter, string> = {
  hostsUndergrads:
    "These don't list undergraduate researchers yet. Many still take students; reach out to ask.",
  welcomesUndergrads:
    "These don't say they welcome undergraduates yet. Many still take students; reach out to ask.",
};

interface ResearchMoreTopicResultsProps {
  clusters: ResearchCluster[];
  accessFilter: MoreTopicResultsAccessFilter;
  onSelect: (label: string) => void;
}

const ResearchMoreTopicResults = ({
  clusters,
  accessFilter,
  onSelect,
}: ResearchMoreTopicResultsProps) => {
  const headingId = useId();
  const noteId = useId();
  if (clusters.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={noteId}
      className="mt-8 border-t border-line pt-6"
    >
      <h2 id={headingId} className="yr-kicker">
        {MORE_TOPIC_RESULTS_HEADING}
      </h2>
      <p id={noteId} className="mt-2 mb-3 text-sm text-ink-soft">
        {MORE_TOPIC_RESULTS_NOTES[accessFilter]}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
        {clusters.map((cluster) => (
          <ResearchHomeCard
            key={cluster.id}
            home={cluster}
            onSelect={onSelect}
            variant="compact"
            openSource="search"
          />
        ))}
      </div>
    </section>
  );
};

export default ResearchMoreTopicResults;
