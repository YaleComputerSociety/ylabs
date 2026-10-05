export const researchProfilePageClassName =
  'mx-auto w-full max-w-(--breakpoint-2xl) px-4 py-6 sm:py-8 lg:px-8';
export const researchProfileGridClassName = 'grid grid-cols-1 gap-6 lg:gap-8';
export const researchProfileColumnClassName =
  'lg:mx-auto lg:w-full lg:max-w-5xl space-y-6 sm:space-y-8';

const SkeletonBar = ({ className }: { className: string }) => (
  <div className={`rounded-control bg-panel-muted ${className}`} />
);

const ResearchProfileSkeleton = () => (
  <div role="status" aria-label="Loading research profile" className={researchProfilePageClassName}>
    <div className={researchProfileGridClassName}>
      <div className={researchProfileColumnClassName}>
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

        <div className="rounded-card border border-line bg-panel p-4 shadow-yr-raised sm:p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
            <div>
              <SkeletonBar className="h-5 w-48" />
              <SkeletonBar className="mt-4 h-3 w-full" />
              <SkeletonBar className="mt-3 h-3 w-full" />
              <SkeletonBar className="mt-3 h-3 w-11/12" />
              <SkeletonBar className="mt-3 h-3 w-2/3" />
              <p className="mt-5 text-xs text-muted">Loading research profile</p>
            </div>
            <div className="h-40 rounded-card border border-line bg-panel-muted" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default ResearchProfileSkeleton;
