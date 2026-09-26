// Copying any of these is a defect rather than a policy choice: telemetry
// would attribute one environment's student behavior to another, a copied
// lock lets a second environment's scraper believe a job is already held, a
// copied quality snapshot both misdates the target's history and loses it,
// and a copied gate scorecard presents one environment's promotion verdict as
// the other's, because a promotion replaces the whole collection. A lane
// benchmark and its scorecards are the same kind of environment-local history.
export const NEVER_COPY_COLLECTIONS = [
  'analytics_events',
  'scrape_job_locks',
  'corpus_quality_snapshots',
  'gate_scorecard_snapshots',
  'lane_benchmarks',
  'lane_benchmark_pages',
  'lane_scorecard_snapshots',
];

export function assertNoNeverCopyCollections(collectionNames: string[]): void {
  const forbidden = collectionNames.filter((name) => NEVER_COPY_COLLECTIONS.includes(name));
  if (forbidden.length > 0) {
    throw new Error(`Refusing to mirror environment-local collections: ${forbidden.join(', ')}`);
  }
}
