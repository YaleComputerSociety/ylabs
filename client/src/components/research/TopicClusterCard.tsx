import { Link } from 'react-router-dom';

import EvidenceSourceRow from './EvidenceSourceRow';
import type { ResearchCluster } from '../../utils/researchDiscoveryAdapters';

interface TopicClusterCardProps {
  cluster: ResearchCluster;
  onSelect?: (label: string) => void;
}

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const TopicClusterCard = ({ cluster, onSelect }: TopicClusterCardProps) => {
  const clusterEntities = cluster.entities
    .slice(0, 3)
    .map((entity) => ({
      id: entity._id || entity.slug,
      slug: entity.slug,
      label: entity.displayName || entity.name || 'Untitled research profile',
    }));

  return (
    <article className="rounded-md border border-l-2 border-gray-200 border-l-blue-700 bg-white p-4 transition-colors hover:border-blue-200 hover:border-l-blue-700">
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-lg font-semibold leading-tight text-gray-950">
            {cluster.label}
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cluster.labels.map((label) => (
            <span
              key={label}
              className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
            >
              {label}
            </span>
          ))}
        </div>
        <p className="line-clamp-2 font-serif text-sm leading-relaxed text-gray-600">
          {cluster.description}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
        <span className="rounded bg-gray-50 px-2 py-1">
          {countLabel(cluster.entityCount, 'profile', 'profiles')}
        </span>
        {cluster.peopleCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(cluster.peopleCount, 'person', 'people')}
          </span>
        )}
        {cluster.paperCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(cluster.paperCount, 'paper', 'papers')}
          </span>
        )}
        {cluster.pathwayCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(cluster.pathwayCount, 'pathway', 'pathways')}
          </span>
        )}
      </div>

      {cluster.metadataTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cluster.metadataTags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
              {tag}
            </span>
          ))}
        </div>
      )}

      {cluster.entities.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Profiles in this cluster
          </p>
          <div className="flex flex-col gap-1">
            {clusterEntities.map((entity) => {
              if (!entity.slug) {
                return (
                  <span
                    key={entity.id || entity.label}
                    className="text-sm text-gray-700"
                    title="Profile link is not available yet."
                  >
                    {entity.label}
                  </span>
                );
              }

              return (
                <Link
                  key={entity.slug}
                  to={`/research/${entity.slug}`}
                  className="inline-flex min-h-[44px] items-center text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  {entity.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Why matched
        </p>
        <EvidenceSourceRow evidence={cluster.evidence} compact />
      </div>

      {onSelect && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onSelect(cluster.label)}
            className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore cluster
          </button>
        </div>
      )}
    </article>
  );
};

export default TopicClusterCard;
