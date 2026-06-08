import type { EvidenceSourceRowData } from '../../utils/researchDiscoveryAdapters';
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../utils/url';

interface EvidenceSourceRowProps {
  evidence: EvidenceSourceRowData[];
  compact?: boolean;
  className?: string;
}

const labelize = (value: string): string =>
  value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatSourceType = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const looksEnumLike = /[_-]/.test(trimmed) || trimmed === trimmed.toUpperCase();
  return looksEnumLike ? labelize(trimmed) : trimmed;
};

const formatDate = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const formatConfidence = (value?: number | string): string => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return `${Math.round(value * 100)}% confidence`;
  if (value === 'metadata fallback') return 'Based on visible Yale metadata';
  if (value === 'unresolved identity') return 'Identity unresolved';
  return `${labelize(value)} confidence`;
};

const EvidenceSourceRow = ({
  evidence,
  compact = false,
  className = '',
}: EvidenceSourceRowProps) => {
  if (!evidence || evidence.length === 0) {
    return (
      <p className={`text-xs text-gray-600 ${className}`.trim()}>
        No source evidence attached
      </p>
    );
  }

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {evidence.map((item, index) => {
        const confidence = compact ? '' : formatConfidence(item.confidence);
        const observedDate = compact ? '' : formatDate(item.observedDate);
        const sourceType = compact ? '' : formatSourceType(item.sourceType);
        const sourceUrl = safeHttpUrl(item.url);
        return (
          <div
            key={`${item.claim}-${index}`}
            className={compact ? 'border-t border-[var(--yr-line)] pt-2 first:border-t-0 first:pt-0' : 'rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3'}
          >
            <p className="text-sm font-medium leading-snug text-gray-900">{item.claim}</p>
            {(sourceType || confidence || observedDate) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                {sourceType && <span>{sourceType}</span>}
                {confidence && <span>{confidence}</span>}
                {observedDate && <span>Observed {observedDate}</span>}
              </div>
            )}
            {item.excerpt && (
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.excerpt}</p>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Open source
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default EvidenceSourceRow;
