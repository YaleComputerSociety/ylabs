/**
 * Resolves the roster email aliases the corpus is keyed by to the netid the Yale directory holds.
 *
 * A department roster publishes the friendly address (`first.last@yale.edu`) rather than the netid
 * (`fl123`), the alias passes the netid shape test, and the observation is stamped
 * `netid:<alias>`. Every consumer then has to resolve that key through a second `email`
 * observation to reach a person, and the corpus cannot supply that mapping itself: every `netid`
 * field value stored on an alias key repeats the alias, measured 9,738 of 9,738 across five
 * sources.
 *
 * This runs as a lane rather than the one-off script #3352 shipped, because the roster mints new
 * alias keys on every scrape. A repair leaves the corpus to re-diverge by exactly the mechanism it
 * just fixed; a lane keeps the join an invariant.
 *
 * It emits one `email` observation keyed by the REAL netid carrying the alias address, which is the
 * shape `resolveNetidForRosterEmailAlias` already reads, so no resolver learns a new rule.
 */
import { Observation } from '../../models/observation';
import { getCached, setCached } from '../snapshotCache';
import {
  aliasFromObservationKey,
  emailLocalPart,
  indexDirectory,
  planAliasResolutions,
  summarizeAliasResolutions,
  type AliasObservationKey,
  type DirectoryIdentity,
} from '../utils/aliasObservationKeyResolution';
import { listYalies, type YaliesPerson } from '../../services/yaliesService';
import { userLookupValueForInferredPiUserKey } from '../entityMaterializer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const SOURCE_KEY = 'directory-alias-resolution';
const DIRECTORY_PAGE_SIZE = 100;
const DIRECTORY_MAX_PAGES = 600;
const DIRECTORY_PAGE_DELAY_MS = 120;
const DIRECTORY_PAGE_ATTEMPTS = 4;
const DIRECTORY_RETRY_BASE_MS = 500;

const toDirectoryIdentity = (person: YaliesPerson): DirectoryIdentity => ({
  netid: person.netid,
  email: person.email,
  firstName: (person as { first_name?: string }).first_name,
  lastName: (person as { last_name?: string }).last_name,
  schoolCode: (person as { school_code?: string }).school_code,
});

/**
 * The directory walk is hundreds of requests, and a single page failing part-way through is a
 * normal occurrence rather than an outage: one bare call killed a whole run in testing while the
 * same request succeeded immediately after. `resolveLeadNetidsFromDirectory` already retries for
 * this reason, so the constants match it.
 */
export async function fetchDirectoryPageWithRetry(
  page: number,
  fetchPage: (page: number) => Promise<YaliesPerson[]>,
  sleep: (ms: number) => Promise<void>,
  log?: (message: string) => void,
): Promise<YaliesPerson[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DIRECTORY_PAGE_ATTEMPTS; attempt += 1) {
    try {
      return await fetchPage(page);
    } catch (error) {
      lastError = error;
      log?.(`directory page ${page} attempt ${attempt} failed`);
      if (attempt === DIRECTORY_PAGE_ATTEMPTS) break;
      await sleep(DIRECTORY_RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`directory page ${page} failed`);
}

export async function loadDirectoryIdentities(options?: {
  fetchPage?: (page: number) => Promise<YaliesPerson[]>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<DirectoryIdentity[]> {
  const fetchPage =
    options?.fetchPage ?? ((page: number) => listYalies({ page, pageSize: DIRECTORY_PAGE_SIZE }));
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const people: YaliesPerson[] = [];
  for (let page = 1; page <= DIRECTORY_MAX_PAGES; page += 1) {
    const rows = await fetchDirectoryPageWithRetry(page, fetchPage, sleep, options?.log);
    people.push(...rows);
    if (rows.length < DIRECTORY_PAGE_SIZE) break;
    await sleep(DIRECTORY_PAGE_DELAY_MS);
  }
  return people.map(toDirectoryIdentity);
}

const CACHE_REQUEST_KEY = 'directory:all-identities';

async function loadDirectoryIdentitiesCached(ctx: ScraperContext): Promise<DirectoryIdentity[]> {
  if (ctx.options.useCache) {
    const cached = await getCached<DirectoryIdentity[]>(SOURCE_KEY, CACHE_REQUEST_KEY);
    if (cached?.length) {
      ctx.log(`directory from snapshot cache: ${cached.length} people`);
      return cached;
    }
  }
  const identities = await loadDirectoryIdentities({ log: (message) => ctx.log(message) });
  if (ctx.options.useCache) await setCached(SOURCE_KEY, CACHE_REQUEST_KEY, identities);
  return identities;
}

/**
 * Reads the value through `userLookupValueForInferredPiUserKey` rather than off the raw key, and
 * drops a self-match, so this agrees with `resolveNetidForRosterEmailAlias` instead of becoming a
 * second opinion about the same question.
 */
export async function corpusResolvableAliases(): Promise<Set<string>> {
  const emails = (await Observation.find(
    { entityType: 'user', field: 'email', superseded: false },
    { entityKey: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: unknown; value?: unknown }>;

  const netidsByAlias = new Map<string, Set<string>>();
  for (const row of emails) {
    const alias = emailLocalPart(row.value);
    if (!alias) continue;
    const netid = String(userLookupValueForInferredPiUserKey(row.entityKey) ?? '').toLowerCase();
    if (!netid || netid === alias) continue;
    const bucket = netidsByAlias.get(alias);
    if (bucket) bucket.add(netid);
    else netidsByAlias.set(alias, new Set([netid]));
  }
  return new Set(
    [...netidsByAlias].filter(([, netids]) => netids.size === 1).map(([alias]) => alias),
  );
}

export async function aliasObservationKeys(): Promise<AliasObservationKey[]> {
  const grouped = (await Observation.aggregate([
    { $match: { entityType: 'user', entityKey: { $regex: /^netid:[^:]*\./ } } },
    { $group: { _id: '$entityKey', observationCount: { $sum: 1 } } },
    { $sort: { observationCount: -1 } },
  ])) as Array<{ _id: string; observationCount: number }>;
  return grouped
    .filter((row) => aliasFromObservationKey(row._id))
    .map((row) => ({ entityKey: row._id, observationCount: row.observationCount }));
}

export class DirectoryAliasResolutionScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Directory alias resolution';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limit = ctx.options.limit;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const [directory, resolvable, keys] = await Promise.all([
      loadDirectoryIdentitiesCached(ctx),
      corpusResolvableAliases(),
      aliasObservationKeys(),
    ]);
    ctx.log(
      `directory ${directory.length} people; ${keys.length} alias keys; ${resolvable.size} already resolvable`,
    );

    const scoped = limit ? keys.slice(0, limit) : keys;
    const outcome = planAliasResolutions(scoped, indexDirectory(directory), resolvable);
    const summary = summarizeAliasResolutions(outcome);
    for (const [refusal, count] of Object.entries(summary.byRefusal)) {
      ctx.log(`refused ${refusal}: ${count} keys`);
    }

    const observations: ObservationInput[] = outcome.planned.map((plan) => ({
      entityType: 'user',
      entityKey: `netid:${plan.netid}`,
      field: 'email',
      value: `${plan.alias}@yale.edu`,
    }));
    if (observations.length) await ctx.emit(observations);

    const refusalNote = Object.entries(summary.byRefusal)
      .map(([refusal, count]) => `${refusal}=${count}`)
      .join(', ');
    return {
      observationCount: observations.length,
      entitiesObserved: observations.length,
      notes: `resolved ${summary.planned} of ${scoped.length} alias keys, unlocking ${summary.plannedObservations} observations${refusalNote ? `; refused ${refusalNote}` : ''}`,
    };
  }
}
