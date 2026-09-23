import type { DepartmentCourseCreditRoute } from '../../types/labDetail';
import { safeHttpUrl } from '../../utils/url';

/**
 * Renders a for-credit research route that belongs to the department, not to the
 * entity whose page this is (#2214).
 *
 * Every string here names the department as the subject. The cited page is a
 * department page and says nothing about this entity, so the copy must never read
 * as a claim about it, and the department name is always shown beside the route.
 */
export const DepartmentResearchContextSection = ({
  routes,
}: {
  routes?: DepartmentCourseCreditRoute[];
}) => {
  const usable = (routes || []).filter(
    (route) => route.departmentName && route.evidenceQuote && safeHttpUrl(route.sourceUrl),
  );
  if (usable.length === 0) return null;

  return (
    <section aria-labelledby="department-context-heading">
      <h2
        id="department-context-heading"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600"
      >
        Department context
      </h2>
      <div className="space-y-3">
        {usable.map((route) => {
          const sourceUrl = safeHttpUrl(route.sourceUrl);
          return (
            <article
              key={`${route.departmentName}:${route.sourceUrl}`}
              className="min-w-0 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4"
            >
              <h3 className="text-sm font-semibold text-gray-900">
                {route.departmentName} offers undergraduate research for course credit
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                This is a route the department offers across the department. It is not a statement
                about this listing, and it is not an offer of a place here.
              </p>
              <blockquote className="mt-3 border-l-2 border-[var(--yr-line)] pl-3 text-sm leading-relaxed text-gray-700">
                {route.evidenceQuote}
              </blockquote>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:text-brand-navy yr-focus-ring"
              >
                {route.departmentName} course page
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
};
