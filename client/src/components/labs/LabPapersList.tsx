/**
 * Research-activity link list for a research profile. Each card links to the
 * real scholarly destination students can inspect.
 *
 * Pure presentational — receives the papers as a prop.
 */
import { LabPaper, LabScholarlyLink } from '../../types/labDetail';
import { ensureHttpPrefix, safeUrl } from '../../utils/url';

type ResearchActivityLink = LabPaper | LabScholarlyLink;

interface LabPapersListProps {
  papers: ResearchActivityLink[];
  emptyText?: string;
  showPreprintMeta?: boolean;
}

const isScholarlyLink = (paper: ResearchActivityLink): paper is LabScholarlyLink =>
  'destinationKind' in paper && 'displaySource' in paper;

const resolvePaperLink = (paper: ResearchActivityLink): string => {
  if (isScholarlyLink(paper)) return safeUrl(paper.url);
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  const landing = paper.landingPageUrl ? safeUrl(paper.landingPageUrl) : '';
  if (landing) return landing;
  const oa = paper.openAccessUrl ? safeUrl(paper.openAccessUrl) : '';
  if (oa) return oa;
  return paper.url ? ensureHttpPrefix(paper.url) : '';
};

const resolveDisplayDate = (paper: ResearchActivityLink): string | undefined => {
  if (isScholarlyLink(paper)) return undefined;
  const rawDate = paper.postedAt || paper.versionDate || paper.publishedAt;
  if (!rawDate) return undefined;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const resolveYear = (paper: ResearchActivityLink): number | undefined => {
  if (paper.year) return paper.year;
  if (isScholarlyLink(paper)) return undefined;
  if (paper.publishedAt) {
    const d = new Date(paper.publishedAt);
    if (!Number.isNaN(d.getTime())) return d.getFullYear();
  }
  return undefined;
};

const LabPapersList = ({
  papers,
  emptyText = 'No recent papers.',
  showPreprintMeta = false,
}: LabPapersListProps) => {
  if (!papers || papers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center">
        <p className="text-sm text-slate-600">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="yr-card divide-y divide-slate-200 overflow-hidden rounded-md">
      {papers.map((paper, index) => {
        const link = resolvePaperLink(paper);
        const year = resolveYear(paper);
        const displayDate = resolveDisplayDate(paper);
        const sourceLabel = isScholarlyLink(paper)
          ? paper.displaySource
          : showPreprintMeta
            ? 'arXiv preprint'
            : 'Paper';
        const titleEl = (
          <span className="text-base font-semibold leading-snug text-slate-950 transition-colors group-hover:text-[var(--yr-blue)]">
            {paper.title}
          </span>
        );
        return (
          <article
            key={paper._id}
            className="group grid gap-3 px-4 py-4 transition-colors hover:bg-[var(--yr-blue-soft)]/45 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:px-5"
          >
            <div className="hidden sm:block">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-50 font-mono text-xs font-semibold text-slate-700">
                {String(index + 1).padStart(2, '0')}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="yr-pill yr-pill-blue min-h-0 px-2.5 py-0.5">
                  {sourceLabel}
                </span>
                {paper.venue && (
                  <span className="max-w-full truncate text-xs font-medium text-slate-600">
                    {paper.venue}
                  </span>
                )}
                {displayDate ? (
                  <span className="text-xs text-slate-500">posted {displayDate}</span>
                ) : (
                  year !== undefined && <span className="text-xs text-slate-500">{year}</span>
                )}
                {!isScholarlyLink(paper) && typeof paper.citationCount === 'number' && paper.citationCount > 0 && (
                  <span className="text-xs text-slate-500">
                    {paper.citationCount} citation{paper.citationCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  {titleEl}
                </a>
              ) : (
                titleEl
              )}
              {!isScholarlyLink(paper) && paper.tldr && (
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{paper.tldr}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="yr-link">
                    Open source
                  </a>
                )}
                {isScholarlyLink(paper) && paper.freeFullTextUrl && (
                  <a
                    href={safeUrl(paper.freeFullTextUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yr-link"
                  >
                    {paper.freeFullTextLabel || 'Free full text'}
                  </a>
                )}
                {showPreprintMeta && !isScholarlyLink(paper) && paper.pdfUrl && (
                  <a
                    href={safeUrl(paper.pdfUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yr-link"
                  >
                    PDF
                  </a>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default LabPapersList;
