import type { ReactNode } from 'react';

export const researchProfilePageClassName =
  'mx-auto w-full max-w-(--breakpoint-2xl) px-4 py-6 sm:py-8 lg:px-8';
export const researchProfileGridClassName = 'grid grid-cols-1 gap-6 lg:gap-8';
export const researchProfileColumnClassName =
  'lg:mx-auto lg:w-full lg:max-w-5xl space-y-6 sm:space-y-8';
export const researchProfileBodyGridClassName = 'grid grid-cols-1 gap-6 sm:gap-8 md:flow-root';
export const researchProfileSummaryCardClassName =
  'min-w-0 rounded-card border border-line bg-panel p-4 shadow-yr-raised sm:p-5 md:float-left md:mb-8 md:w-[calc(100%-19.25rem)]';
export const researchProfileContactRailClassName =
  'divide-y divide-[var(--yr-line)] self-start rounded-card border border-line bg-[var(--yr-panel-muted)] p-4 shadow-yr-raised md:float-right md:mb-4 md:ml-5 md:min-h-(--summary-card-height) md:w-72';
export const researchProfileBodyMainClassName =
  'min-w-0 space-y-6 sm:space-y-8 md:*:flow-root md:*:min-w-80';

const SkeletonBar = ({ className }: { className: string }) => (
  <div className={`rounded-control bg-panel-muted ${className}`} />
);

const ResearchProfileSkeleton = ({ leading }: { leading?: ReactNode }) => (
  <div role="status" aria-label="Loading research profile" className={researchProfilePageClassName}>
    <div className={researchProfileGridClassName}>
      <div className={researchProfileColumnClassName}>
        {leading}
        <div className="space-y-6 sm:space-y-8">
          <div className="yr-panel flex flex-col gap-4 rounded-card p-4 sm:p-6">
            <div className="flex gap-2">
              <SkeletonBar className="h-6 w-16" />
              <SkeletonBar className="h-6 w-24" />
            </div>
            <div>
              <SkeletonBar className="h-3 w-28" />
              <SkeletonBar className="mt-3 h-9 w-3/4 sm:h-10" />
              <SkeletonBar className="mt-3 h-4 w-1/3" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <SkeletonBar className="h-6 w-32" />
              <SkeletonBar className="h-6 w-24" />
            </div>
          </div>

          <div className={researchProfileBodyGridClassName}>
            <div className={researchProfileSummaryCardClassName}>
              <SkeletonBar className="h-5 w-48" />
              <SkeletonBar className="mt-4 h-3 w-full" />
              <SkeletonBar className="mt-3 h-3 w-full" />
              <SkeletonBar className="mt-3 h-3 w-11/12" />
              <SkeletonBar className="mt-3 h-3 w-2/3" />
              <p className="mt-5 text-xs text-muted">Loading research profile</p>
            </div>
            <div className={`${researchProfileContactRailClassName} h-40`} />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default ResearchProfileSkeleton;
