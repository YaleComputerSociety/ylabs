import { Link } from 'react-router-dom';

import EvidenceSourceRow from './EvidenceSourceRow';
import type { ResearchCluster } from '../../utils/researchDiscoveryAdapters';

interface ResearchHomeCardProps {
  home: ResearchCluster;
  onSelect?: (label: string) => void;
}

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const ResearchHomeCard = ({ home, onSelect }: ResearchHomeCardProps) => {
  const homeEntities = home.entities
    .slice(0, 3)
    .map((entity) => ({
      id: entity._id || entity.slug,
      slug: entity.slug,
      label: entity.displayName || entity.name || 'Untitled research profile',
    }));

  return (
    <article className="rounded-md border border-l-2 border-gray-200 border-l-blue-700 bg-white p-4 transition-colors hover:border-blue-200 hover:border-l-blue-700">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold leading-tight text-gray-950">
          {home.label}
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {home.labels.map((label) => (
            <span
              key={label}
              className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
            >
              {label}
            </span>
          ))}
        </div>

        <p className="line-clamp-2 text-sm leading-relaxed text-gray-600">
          {home.description}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
        <span className="rounded bg-gray-50 px-2 py-1">
          {countLabel(home.entityCount, 'research home', 'research homes')}
        </span>
        {home.peopleCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(home.peopleCount, 'contact', 'contacts')}
          </span>
        )}
        {home.paperCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(home.paperCount, 'paper signal', 'paper signals')}
          </span>
        )}
        {home.pathwayCount > 0 && (
          <span className="rounded bg-gray-50 px-2 py-1">
            {countLabel(home.pathwayCount, 'next step', 'next steps')}
          </span>
        )}
      </div>

      {home.metadataTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {home.metadataTags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
              {tag}
            </span>
          ))}
        </div>
      )}

      {home.entities.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Research homes
          </p>
          <div className="flex flex-col gap-1">
            {homeEntities.map((entity) => {
              if (!entity.slug) {
                return (
                  <span
                    key={entity.id || entity.label}
                    className="text-sm text-gray-700"
                    title="Research profile link is not available yet."
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
          Why this matches
        </p>
        <EvidenceSourceRow evidence={home.evidence} compact />
      </div>

      {onSelect && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onSelect(home.label)}
            className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore home
          </button>
        </div>
      )}
    </article>
  );
};

export default ResearchHomeCard;
