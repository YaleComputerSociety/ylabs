/**
 * How each Source row is dispatched, so a freshness worklist can only report work an
 * operator is able to do (#2619).
 *
 * `buildOrchestrator()` is the authority for sweep dispatch: the CLI, the cron, and the
 * sweep all resolve a source name through it, so a name it does not carry cannot be
 * crawled whatever the row says. Script-driven lanes write observations from a named
 * command instead, and nothing enumerates them, so they are declared here next to the
 * command that owns each one. A row in none of the three groups is `unowned`: nothing
 * can run it and nothing has declared it finished, which is the state this module exists
 * to surface rather than fold into a worklist.
 */
import { RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES } from './retiredPaperPipeline';

export type SourceDispatch = 'sweep-registered' | 'script-driven' | 'retired' | 'unowned';

/**
 * Retired source rows. `seedSources` stamps every name here with the repo's retirement
 * marker (`enabled: false`, `cadence: 'retired'`, a retirement note, and no coverage
 * metadata) while leaving stored observations and scrape runs untouched as evidence.
 */
export const RETIRED_SOURCE_NAMES: string[] = [
  'yale-course-catalog',
  'apify-google-scholar-bootstrap',
  'apify-google-scholar',
  'student-decision-llm',
  'external-fellowship-llm-scraper',
  // Museum, collections, and digital-humanities research homes retired with the entity
  // types they produced (#2202). See docs/research-data-pipeline.md.
  'beinecke-collections-research',
  'beinecke-curatorial-units',
  'course-based-research-pathways',
  'dh-lab-projects',
  'library-collections-as-data',
  'peabody-collections-research',
  'ycba-collections-research',
  'yuag-curatorial-areas',
  // Superseded by 'lab-microsite-description-llm' and 'lab-microsite-undergrad-llm'.
  'lab-microsite-llm',
  'ylabs-listing',
  // One-time local JSON imports; the import path no longer exists.
  'root-yale-history-faculty-json',
  'root-yale-medicine-labs-json',
  'root-yale-physics-faculty-json',
  // Ad-hoc lanes whose writing code is no longer in the tree, so they cannot be re-run.
  'holdfix-second-opinion',
  'holdfix-second-opinion-worker',
  'official-profile-enrichment',
  'research-entity-cache-backfill',
  'yale-directory-csv',
  ...RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES,
];

/**
 * Lanes that write observations from a named command rather than the sweep. The value is
 * the command or channel an operator invokes, so a worklist can say what to run instead
 * of implying a crawl that would fail with "No scraper registered with name".
 */
export const SCRIPT_DRIVEN_SOURCE_OWNERS: Record<string, string> = {
  'fra-profile-research-synthesis': 'yarn --cwd server research-entity:fra-profile-synthesis',
  'grant-corpus-synthesis-llm': 'yarn --cwd server research-entity:grant-corpus-synthesis',
  'lab-site-declared-lead-llm': 'yarn --cwd server observations:retarget-foreign-lab-websites',
  'lab-site-type-probe': 'yarn --cwd server research-entity:promote-faculty-research',
  'manual-admin-edit': 'admin dashboard entity edit',
  'manual-pi-edit': 'PI dashboard lab edit',
  'visibility-repair-queue': 'yarn --cwd server beta:repair-queue',
};

export const SCRIPT_DRIVEN_SOURCE_NAMES = Object.keys(SCRIPT_DRIVEN_SOURCE_OWNERS);

export function scriptDrivenSourceOwner(name: string): string | undefined {
  return Object.hasOwn(SCRIPT_DRIVEN_SOURCE_OWNERS, name)
    ? SCRIPT_DRIVEN_SOURCE_OWNERS[name]
    : undefined;
}

export function isRetiredSourceName(name: string): boolean {
  return RETIRED_SOURCE_NAMES.includes(name);
}

export function resolveSourceDispatch(
  name: string,
  registeredScraperNames: Iterable<string>,
): SourceDispatch {
  if (new Set(registeredScraperNames).has(name)) return 'sweep-registered';
  if (isRetiredSourceName(name)) return 'retired';
  if (scriptDrivenSourceOwner(name)) return 'script-driven';
  return 'unowned';
}

export interface SourceDispatchPartition {
  sweepRegistered: string[];
  scriptDriven: string[];
  retired: string[];
  unowned: string[];
}

export function partitionSourcesByDispatch(
  sourceNames: Iterable<string>,
  registeredScraperNames: Iterable<string>,
): SourceDispatchPartition {
  const registered = new Set(registeredScraperNames);
  const partition: SourceDispatchPartition = {
    sweepRegistered: [],
    scriptDriven: [],
    retired: [],
    unowned: [],
  };
  const byDispatch: Record<SourceDispatch, string[]> = {
    'sweep-registered': partition.sweepRegistered,
    'script-driven': partition.scriptDriven,
    retired: partition.retired,
    unowned: partition.unowned,
  };
  for (const name of sourceNames) {
    byDispatch[resolveSourceDispatch(name, registered)].push(name);
  }
  return partition;
}

/**
 * Registered scrapers with no Source row. `validateScraperSweepSourceRows` refuses to
 * start a sweep in this state; reporting it keeps the audit from reading green while the
 * sweep would refuse to run.
 */
export function findRegisteredScrapersWithoutSourceRow(
  registeredScraperNames: Iterable<string>,
  sourceNames: Iterable<string>,
): string[] {
  const rows = new Set(sourceNames);
  return [...registeredScraperNames].filter((name) => !rows.has(name)).sort();
}
