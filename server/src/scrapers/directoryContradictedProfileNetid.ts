import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import {
  normalizeOfficialProfileDestination,
  officialProfileDestinationIndexedPatterns,
} from '../services/leadProfileIdentity';

export const OFFICIAL_PROFILE_PI_BACKFILL_SOURCE = 'official-profile-pi-backfill';

const DIRECTORY_IDENTITY_SOURCE_NAMES = [
  'yale-directory',
  'yale-directory-csv',
  'directory-alias-resolution',
];

const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;

export type DirectoryNetidsByAddress = ReadonlyMap<string, ReadonlySet<string>>;

type KeyedObservation = {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
};

const BARE_NETID = /^[a-z0-9]+$/;

function netidOfDirectoryUserKey(entityKey: unknown): string {
  const netid = String(entityKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/^netid:/, '');
  return BARE_NETID.test(netid) ? netid : '';
}

export function netidOfNetidUserKey(entityKey: unknown): string {
  const key = String(entityKey ?? '')
    .trim()
    .toLowerCase();
  if (!key.startsWith('netid:')) return '';
  return netidOfDirectoryUserKey(key);
}

const normalizedAddress = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export function directoryNetidsByAddressFrom(
  observations: ReadonlyArray<{ entityKey?: unknown; value?: unknown }>,
): DirectoryNetidsByAddress {
  const byAddress = new Map<string, Set<string>>();
  for (const observation of observations) {
    const address = normalizedAddress(observation.value);
    const netid = netidOfDirectoryUserKey(observation.entityKey);
    if (!address || !netid) continue;
    byAddress.set(address, (byAddress.get(address) ?? new Set()).add(netid));
  }
  return byAddress;
}

let cachedDirectory: { loadedAt: number; value: Promise<DirectoryNetidsByAddress> } | undefined;

export function resetDirectoryNetidsByAddressCache(): void {
  cachedDirectory = undefined;
}

/**
 * Every address the Yale directory lanes pair with a netid, read once and reused for a few
 * minutes because the materializer screens thousands of person keys in one pass and a
 * per-key query scans the whole directory email set. No connection reads as an empty map,
 * which leaves every screen open rather than refusing on silence.
 */
export async function loadDirectoryNetidsByAddress(): Promise<DirectoryNetidsByAddress> {
  if (mongoose.connection.readyState !== 1) return new Map();
  if (cachedDirectory && Date.now() - cachedDirectory.loadedAt < DIRECTORY_CACHE_TTL_MS) {
    return cachedDirectory.value;
  }
  const value = Observation.find(
    {
      sourceName: { $in: DIRECTORY_IDENTITY_SOURCE_NAMES },
      entityType: 'user',
      field: 'email',
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    },
    { entityKey: 1, value: 1 },
  )
    .lean()
    .then((rows) => directoryNetidsByAddressFrom(rows as Array<Record<string, unknown>>));
  cachedDirectory = { loadedAt: Date.now(), value };
  value.catch(() => {
    if (cachedDirectory?.value === value) cachedDirectory = undefined;
  });
  return value;
}

export function directoryContradictsNetidForAddress(
  netid: string,
  address: unknown,
  directory: DirectoryNetidsByAddress,
): boolean {
  const named = directory.get(normalizedAddress(address));
  return Boolean(named && named.size > 0 && !named.has(netid.trim().toLowerCase()));
}

/**
 * The netids the Yale directory pairs with a set of addresses one page states, read as that
 * page's owner only when every address the directory knows shares one netid. Addresses that
 * pair with different people, such as a member's own address beside an assistant's, name no
 * owner, and addresses the directory does not know decide nothing.
 */
export function directoryOwnerNetidsOfAddresses(
  addresses: Iterable<unknown>,
  directory: DirectoryNetidsByAddress,
): Set<string> | undefined {
  const pairedNetidSets = [...addresses]
    .map((address) => directory.get(normalizedAddress(address)))
    .filter((netids): netids is ReadonlySet<string> => Boolean(netids && netids.size > 0));
  if (pairedNetidSets.length === 0) return undefined;
  const sharedByEveryAddress = [...pairedNetidSets[0]].some((netid) =>
    pairedNetidSets.every((netids) => netids.has(netid)),
  );
  if (!sharedByEveryAddress) return undefined;
  return new Set(pairedNetidSets.flatMap((netids) => [...netids]));
}

function directoryContradictedProfilePages(
  netid: string,
  observations: readonly KeyedObservation[],
  directory: DirectoryNetidsByAddress,
): Set<string> {
  return new Set(
    observations
      .filter(
        (observation) =>
          observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
          observation.field === 'email' &&
          directoryContradictsNetidForAddress(netid, observation.value, directory),
      )
      .map((observation) => String(observation.sourceUrl ?? '')),
  );
}

/**
 * The official-profile backfill once keyed a profile page by the netid of whichever single
 * researcher held the page or address, without asking whether that researcher was the
 * page's person, so a namesake's netid carries another person's page and address. Those
 * observations are immutable and the lane now keys that page elsewhere, so they are
 * screened on every read: a page whose own address the Yale directory pairs with a
 * different netid is not evidence about the key's person.
 */
export function withoutDirectoryContradictedProfileEvidence<T extends KeyedObservation>(
  entityKey: unknown,
  observations: T[],
  directory: DirectoryNetidsByAddress,
): T[] {
  const netid = netidOfNetidUserKey(entityKey);
  if (!netid) return observations;
  const contradictedPages = directoryContradictedProfilePages(netid, observations, directory);
  if (contradictedPages.size === 0) return observations;
  return observations.filter(
    (observation) =>
      observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
      !contradictedPages.has(String(observation.sourceUrl ?? '')),
  );
}

export interface ScreenedProfileEvidence<T> {
  kept: T[];
  screenedPageUrls: string[];
}

function pageUrlsOf(observations: readonly KeyedObservation[]): string[] {
  const urls = new Set<string>();
  for (const observation of observations) {
    if (typeof observation.sourceUrl === 'string' && observation.sourceUrl) {
      urls.add(observation.sourceUrl);
    }
    if (
      observation.field === 'profileUrls' &&
      observation.value &&
      typeof observation.value === 'object'
    ) {
      for (const url of Object.values(observation.value as Record<string, unknown>)) {
        if (typeof url === 'string' && url) urls.add(url);
      }
    }
  }
  return [...urls];
}

export async function screenDirectoryContradictedProfileEvidenceForKey<T extends KeyedObservation>(
  entityKey: unknown,
  observations: T[],
): Promise<ScreenedProfileEvidence<T>> {
  const unscreened = { kept: observations, screenedPageUrls: [] };
  if (!netidOfNetidUserKey(entityKey)) return unscreened;
  const carriesProfileAddress = observations.some(
    (observation) =>
      observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      observation.field === 'email',
  );
  if (!carriesProfileAddress) return unscreened;
  const kept = withoutDirectoryContradictedProfileEvidence(
    entityKey,
    observations,
    await loadDirectoryNetidsByAddress(),
  );
  if (kept.length === observations.length) return unscreened;
  const keptSet = new Set<T>(kept);
  return {
    kept,
    screenedPageUrls: pageUrlsOf(observations.filter((observation) => !keptSet.has(observation))),
  };
}

export async function withoutDirectoryContradictedProfileEvidenceForKey<T extends KeyedObservation>(
  entityKey: unknown,
  observations: T[],
): Promise<T[]> {
  return (await screenDirectoryContradictedProfileEvidenceForKey(entityKey, observations)).kept;
}

export interface ProfilePageOwnerNetids {
  byPage: ReadonlyMap<string, ReadonlySet<string>>;
  directoryNetids: ReadonlySet<string>;
}

export const directoryNetidsOf = (directory: DirectoryNetidsByAddress): Set<string> => {
  const netids = new Set<string>();
  for (const named of directory.values()) for (const netid of named) netids.add(netid);
  return netids;
};

/**
 * The netids the Yale directory pairs with the email each person page states about itself,
 * keyed by `normalizeOfficialProfileDestination`. Every address a page has stated counts, so a page
 * that changed its address over time still names its owner. A page whose addresses the directory
 * does not all pair with one shared netid, such as a roster listing, is never read as one page's
 * owner, and a page whose email the directory does not know decides nothing (#5693).
 */
export async function profilePageOwnerNetids(
  pageUrls: readonly unknown[],
  readScope: Record<string, unknown>,
  directory?: DirectoryNetidsByAddress,
): Promise<ProfilePageOwnerNetids> {
  const owners = new Map<string, Set<string>>();
  const none: ProfilePageOwnerNetids = { byPage: owners, directoryNetids: new Set() };
  const patterns = new Map<string, RegExp[]>();
  for (const url of pageUrls) {
    const destination = normalizeOfficialProfileDestination(String(url ?? ''));
    const indexed = officialProfileDestinationIndexedPatterns(String(url ?? ''));
    if (destination && indexed.length > 0) patterns.set(destination, indexed);
  }
  if (patterns.size === 0 || mongoose.connection.readyState !== 1) return none;
  const statedEmails = (await Observation.find(
    {
      entityType: 'user',
      field: 'email',
      ...readScope,
      sourceUrl: { $in: [...patterns.values()].flat() },
    },
    { sourceUrl: 1, value: 1 },
  ).lean()) as Array<{ sourceUrl?: unknown; value?: unknown }>;
  if (statedEmails.length === 0) return none;
  const pairs = directory ?? (await loadDirectoryNetidsByAddress());
  const addressesByPage = new Map<string, Set<string>>();
  for (const observation of statedEmails) {
    const destination = normalizeOfficialProfileDestination(String(observation.sourceUrl ?? ''));
    const address = normalizedAddress(observation.value);
    if (!patterns.has(destination) || !address) continue;
    const addresses = addressesByPage.get(destination) ?? new Set<string>();
    addresses.add(address);
    addressesByPage.set(destination, addresses);
  }
  for (const [destination, addresses] of addressesByPage) {
    const owner = directoryOwnerNetidsOfAddresses(addresses, pairs);
    if (owner) owners.set(destination, owner);
  }
  return {
    byPage: owners,
    directoryNetids: owners.size > 0 ? directoryNetidsOf(pairs) : new Set(),
  };
}

/**
 * Whether the page's own stated email names somebody other than this netid. A researcher with no
 * netid, or a page the directory cannot place, is never contradicted. Nor is a researcher whose
 * stored netid the directory does not hold: that is most often the person's own email alias
 * stamped as a netid, so it is the page owner under a second spelling, not a different person
 * (22 of the first 24 screened lead observations on Development were that shape).
 */
export function profilePageContradictsNetid(
  owners: ProfilePageOwnerNetids,
  pageUrl: unknown,
  netid: unknown,
): boolean {
  const bare = typeof netid === 'string' ? netid.trim().toLowerCase() : '';
  if (!bare) return false;
  if (!owners.directoryNetids.has(bare)) return false;
  const named = owners.byPage.get(normalizeOfficialProfileDestination(String(pageUrl ?? '')));
  return Boolean(named && named.size > 0 && !named.has(bare));
}
