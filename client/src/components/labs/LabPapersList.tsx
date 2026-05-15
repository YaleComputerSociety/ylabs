/**
 * Recent-papers list for a lab. Each card shows title, venue + year, tldr,
 * and a link to read.
 *
 * Pure presentational — receives the papers as a prop.
 */
import { LabPaper } from '../../types/labDetail';
import { ensureHttpPrefix, safeUrl } from '../../utils/url';

interface LabPapersListProps {
  papers: LabPaper[];
  emptyText?: string;
  showPreprintMeta?: boolean;
}

const resolvePaperLink = (paper: LabPaper): string => {
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  const landing = paper.landingPageUrl ? safeUrl(paper.landingPageUrl) : '';
  if (landing) return landing;
  const oa = paper.openAccessUrl ? safeUrl(paper.openAccessUrl) : '';
  if (oa) return oa;
  return paper.url ? ensureHttpPrefix(paper.url) : '';
};

const resolveDisplayDate = (paper: LabPaper): string | undefined => {
  const rawDate = paper.postedAt || paper.versionDate || paper.publishedAt;
  if (!rawDate) return undefined;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const resolveYear = (paper: LabPaper): number | undefined => {
  if (paper.year) return paper.year;
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
    return <p className="text-gray-500 text-sm py-8 text-center">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {papers.map((paper) => {
        const link = resolvePaperLink(paper);
        const year = resolveYear(paper);
        const displayDate = resolveDisplayDate(paper);
        const titleEl = (
          <span className="text-sm font-semibold text-gray-900 hover:text-blue-700 transition-colors">
            {paper.title}
          </span>
        );
        return (
          <div
            key={paper._id}
            className="p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all bg-white"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {titleEl}
                  </a>
                ) : (
                  titleEl
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                  {showPreprintMeta && (
                    <span className="font-medium not-italic text-blue-700">arXiv preprint</span>
                  )}
                  {paper.venue && <span className="italic">{paper.venue}</span>}
                  {showPreprintMeta && displayDate ? (
                    <span>&middot; posted {displayDate}</span>
                  ) : (
                    year !== undefined && <span>&middot; {year}</span>
                  )}
                  {typeof paper.citationCount === 'number' && paper.citationCount > 0 && (
                    <span>&middot; {paper.citationCount} citation{paper.citationCount !== 1 ? 's' : ''}</span>
                  )}
                  {showPreprintMeta && paper.pdfUrl && (
                    <a
                      href={safeUrl(paper.pdfUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:text-blue-900"
                    >
                      &middot; PDF
                    </a>
                  )}
                </div>
                {paper.tldr && (
                  <p className="text-sm text-gray-700 leading-relaxed mt-2">{paper.tldr}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LabPapersList;
