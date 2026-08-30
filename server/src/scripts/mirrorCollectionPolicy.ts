// Copying either of these is a defect rather than a policy choice: telemetry
// would attribute one environment's student behavior to another, and a copied
// lock lets a second environment's scraper believe a job is already held.
const NEVER_COPY_COLLECTIONS = ['analytics_events', 'scrape_job_locks'];

export function assertNoNeverCopyCollections(collectionNames: string[]): void {
  const forbidden = collectionNames.filter((name) => NEVER_COPY_COLLECTIONS.includes(name));
  if (forbidden.length > 0) {
    throw new Error(`Refusing to mirror environment-local collections: ${forbidden.join(', ')}`);
  }
}
