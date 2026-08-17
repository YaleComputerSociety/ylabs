/**
 * Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4
 * Research-activity link list for a research profile. Each row links to the
 * real scholarly destination students can inspect, with source evidence first.
 *
 * Pure presentational - receives the scholarly links as a prop.
 */
import { LabScholarlyLink } from '../../types/labDetail';
import { safeHttpUrl } from '../../utils/url';

interface LabPapersListProps {
  papers: LabScholarlyLink[];
  emptyText?: string;
}

const sourceTone = (link: LabScholarlyLink): string => {
  if (link.destinationKind === 'PMC' || link.freeFullTextUrl) return 'yr-pill-green';
  if (link.destinationKind === 'ARXIV' || link.destinationKind === 'OPENALEX') return 'yr-pill-gold';
  return 'yr-pill-blue';
};

const decodeNumericEntity = (value: string, radix: number): string => {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '';
};

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, hex: string) => decodeNumericEntity(hex, 16))
    .replace(/&#(\d{1,7});/g, (_match, decimal: string) => decodeNumericEntity(decimal, 10));
};

const normalizeResearchActivityTitle = (value: unknown): string => {
  let text = typeof value === 'string' ? value : '';

  for (let i = 0; i < 2; i += 1) {
    text = decodeHtmlEntities(text).replace(/<[^>]*>/g, ' ');
  }

  return text.replace(/\s+/g, ' ').trim();
};

const LabPapersList = ({
  papers,
  emptyText = 'No scholarly links yet.',
}: LabPapersListProps) => {
  if (!papers || papers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel)]/70 px-4 py-8 text-center">
        <p className="text-sm text-slate-600">{emptyText}</p>
      </div>
    );
  }

  const sourceLabels = Array.from(new Set(papers.slice(0, 4).map((link) => link.displaySource)));

  return (
    <div className="overflow-hidden rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)]">
      <div className="flex flex-col gap-2 border-b border-[var(--yr-line)] bg-[var(--yr-panel-muted)]/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Research evidence</p>
          <p className="mt-0.5 text-sm text-slate-700">
            {papers.length} linked source{papers.length === 1 ? '' : 's'} students can inspect directly.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sourceLabels.map((label) => (
            <span key={label} className="yr-pill min-h-0 rounded px-2 py-0.5 text-[11px]">
              {label} source
            </span>
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-200">
        {papers.map((link, index) => {
          const href = safeHttpUrl(link.url);
          const freeFullTextHref = safeHttpUrl(link.freeFullTextUrl);
          const year = link.year;
          const title = normalizeResearchActivityTitle(link.title) || 'Untitled research activity';
          const sourceLabel = link.displaySource;
          const titleEl = (
            <span className="text-base font-semibold leading-snug text-slate-950 transition-colors group-hover:text-[var(--yr-blue)]">
              {title}
            </span>
          );
          return (
            <article
              key={link._id}
              className="group grid gap-3 px-4 py-4 transition-colors hover:bg-[var(--yr-blue-soft)]/45 sm:grid-cols-[2.75rem_minmax(0,1fr)_9rem] sm:px-5"
            >
            <div className="hidden sm:block">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] font-mono text-xs font-semibold text-slate-700">
                {String(index + 1).padStart(2, '0')}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`yr-pill min-h-0 px-2.5 py-0.5 ${sourceTone(link)}`}>
                  {sourceLabel}
                </span>
                {link.venue && (
                  <span className="max-w-full truncate text-xs font-medium text-slate-600">
                    {link.venue}
                  </span>
                )}
                {year !== undefined && <span className="text-xs text-slate-500">{year}</span>}
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  {titleEl}
                </a>
              ) : (
                titleEl
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold sm:hidden">
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="yr-link">
                    Open source
                  </a>
                )}
                {freeFullTextHref && (
                  <a
                    href={freeFullTextHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yr-link"
                  >
                    {link.freeFullTextLabel || 'Free full text'}
                  </a>
                )}
              </div>
            </div>
            <div className="hidden items-start justify-end sm:flex">
              <div className="flex flex-col items-end gap-2 text-xs font-semibold">
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yr-focus-ring rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-3 py-2 text-[var(--yr-blue)] transition-colors hover:bg-[var(--yr-panel)]"
                  >
                    Open source
                  </a>
                )}
                {freeFullTextHref && (
                  <a
                    href={freeFullTextHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yr-link rounded-sm"
                  >
                    {link.freeFullTextLabel || 'Free full text'}
                  </a>
                )}
              </div>
            </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default LabPapersList;
