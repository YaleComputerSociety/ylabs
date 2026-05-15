import EvidenceSourceRow from './EvidenceSourceRow';
import type { ResearchIdentityConfidence } from '../../utils/researchDiscoveryAdapters';
import { Link } from 'react-router-dom';

interface IdentityConfidenceCardProps {
  identity: ResearchIdentityConfidence;
}

const IdentityConfidenceCard = ({ identity }: IdentityConfidenceCardProps) => {
  const profileIsInternal = identity.profileUrl?.startsWith('/');

  return (
    <article className="rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-blue-200">
      <div className="flex flex-col gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug text-gray-950">
            {identity.profileUrl && profileIsInternal ? (
              <Link
                to={identity.profileUrl}
                className="hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                {identity.name}
              </Link>
            ) : identity.profileUrl ? (
              <a
                href={identity.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                {identity.name}
              </a>
            ) : (
              identity.name
            )}
          </h3>
          {identity.labName && identity.labSlug ? (
            <Link
              to={`/research/${identity.labSlug}`}
              className="mt-1 inline-flex text-sm font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Lab: {identity.labName}
            </Link>
          ) : identity.labName ? (
            <p className="mt-1 text-sm text-blue-700">Lab: {identity.labName}</p>
          ) : identity.sourceContext ? (
            <p className="mt-1 text-sm text-gray-500">Lab: {identity.sourceContext}</p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <span className="max-w-full rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
            {identity.identityLabel}
          </span>
          {identity.matchLabel && (
            <span className="max-w-full rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
              {identity.matchLabel}
            </span>
          )}
          {identity.ambiguityLabel && (
            <span className="max-w-full rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {identity.ambiguityLabel}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {identity.departments.map((department) => (
          <span key={department} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
            {department}
          </span>
        ))}
        {identity.affiliations.map((affiliation) => (
          <span key={affiliation} className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
            {affiliation}
          </span>
        ))}
        {identity.orcidUrl && (
          <a
            href={identity.orcidUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            ORCID
          </a>
        )}
        <span className="rounded bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
          Source count: {identity.sourceCount}
        </span>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <EvidenceSourceRow evidence={identity.evidence} compact />
      </div>
    </article>
  );
};

export default IdentityConfidenceCard;
