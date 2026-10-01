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
  'engine_benchmarks',
  'engine_benchmark_rows',
  'engine_benchmark_snapshots',
];

// The Development refresh clears every collection the Beta mirror does not
// replace, and these are exactly the collections Beta never mirrors, so without
// a named allowlist one routine refresh destroys them. A frozen lane benchmark
// carries hand labels no code can re-derive, so the loss is permanent.
export const PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS = [
  'analytics_events',
  'corpus_quality_snapshots',
  'gate_scorecard_snapshots',
  'lane_benchmarks',
  'lane_benchmark_pages',
  'lane_scorecard_snapshots',
  'engine_benchmarks',
  'engine_benchmark_rows',
  'engine_benchmark_snapshots',
];

// A lease is state rather than history: it expires and is taken over, so a
// refresh may drop it. This is the only environment-local collection a refresh
// is allowed to clear, and it is named here so that the classification below
// stays exhaustive.
export const EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS = ['scrape_job_locks'];

// Adding a collection to NEVER_COPY_COLLECTIONS without classifying it as
// preserved or ephemeral fails here rather than silently joining the refresh's
// cleared set, so a new instrument's data cannot be destroyed by omission.
export function assertEnvironmentLocalCollectionsClassified(): void {
  const classified = new Set([
    ...PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
    ...EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS,
  ]);
  const unclassified = NEVER_COPY_COLLECTIONS.filter((name) => !classified.has(name));
  if (unclassified.length > 0) {
    throw new Error(
      `Environment-local collections must be classified as preserved or ephemeral: ${unclassified.join(', ')}`,
    );
  }
  const bothWays = PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS.filter((name) =>
    EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS.includes(name),
  );
  if (bothWays.length > 0) {
    throw new Error(
      `Environment-local collections cannot be both preserved and ephemeral: ${bothWays.join(', ')}`,
    );
  }
  const unlisted = [
    ...PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
    ...EPHEMERAL_ENVIRONMENT_LOCAL_COLLECTIONS,
  ].filter((name) => !NEVER_COPY_COLLECTIONS.includes(name));
  if (unlisted.length > 0) {
    throw new Error(
      `Environment-local classifications must name a never-copied collection: ${unlisted.join(', ')}`,
    );
  }
}

export function assertNoPreservedCollectionsCleared(
  clearedCollectionNames: readonly string[],
): void {
  const forbidden = clearedCollectionNames.filter((name) =>
    PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS.includes(name),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to clear environment-local history no code can re-derive: ${forbidden.join(', ')}`,
    );
  }
}

export function assertNoNeverCopyCollections(collectionNames: string[]): void {
  const forbidden = collectionNames.filter((name) => NEVER_COPY_COLLECTIONS.includes(name));
  if (forbidden.length > 0) {
    throw new Error(`Refusing to mirror environment-local collections: ${forbidden.join(', ')}`);
  }
}
