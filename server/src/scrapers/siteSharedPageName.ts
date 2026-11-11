/**
 * A page-stated name that one site states for two sibling pages is the site's name, not
 * either page's (#5618). A shared site such as `macmillan.yale.edu` gives every council
 * page the same `og:site_name`, so a lane that read it named eight council rows after the
 * parent center. The lane now refuses that heading on a sub-path page, but a refusal
 * retracts nothing (#5226), so the stored names stay live; this screen withdraws them on
 * every resolve instead, and writes no field.
 *
 * Two eponymous labs on one host can share a name honestly ("Liu Lab" at `/lab/liu/` and
 * at `/lab/jun_liu/`), so a name its own page path corroborates is kept. Two URLs for one
 * page (a root and its `index.html`) are not siblings, so a duplicate row keeps its name.
 */
import { Types } from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { corroboratedLabNameEponyms } from '../utils/researchHomeNameIdentityAuthority';
import type { MaterializationReadSource } from './materializationChunkPrefetch';

export const PAGE_STATED_NAME_SOURCES: ReadonlySet<string> = new Set([
  'lab-site-research-read',
  'lab-microsite-description-llm',
]);

const PAGE_STATED_NAME_FIELDS: ReadonlySet<string> = new Set(['name', 'displayName']);

const GENERIC_PAGE_HEADING_WORDS: ReadonlySet<string> = new Set([
  'about',
  'and',
  'contact',
  'core',
  'cores',
  'equipment',
  'facilities',
  'facility',
  'group',
  'home',
  'instrumentation',
  'lab',
  'laboratories',
  'laboratory',
  'labs',
  'members',
  'news',
  'our',
  'overview',
  'people',
  'projects',
  'publications',
  'research',
  'resources',
  'services',
  'shared',
  'team',
  'us',
  'welcome',
]);

/**
 * A heading made only of section words ("Laboratories & Equipment", "Our Labs") names a
 * page of a site, never the research a row is, so a page-stated name of that shape is
 * withdrawn wherever it stands (#4916).
 */
export function isGenericPageHeadingName(value: unknown): boolean {
  const words = comparablePageStatedName(value).split(' ').filter(Boolean);
  return words.length > 0 && words.every((word) => GENERIC_PAGE_HEADING_WORDS.has(word));
}

const INDEX_DOCUMENT_SEGMENT_RE = /^(?:index|default|home)\.(?:html?|aspx?|php|shtml)$/i;

export interface PageStatedNameObservation {
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
}

interface SitePage {
  host: string;
  segments: string[];
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function comparablePageStatedName(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .trim();
}

export function sitePage(url: unknown): SitePage | null {
  let parsed: URL;
  try {
    parsed = new URL(textValue(url));
  } catch {
    return null;
  }
  const segments = parsed.pathname
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (segments.length > 0 && INDEX_DOCUMENT_SEGMENT_RE.test(segments[segments.length - 1])) {
    segments.pop();
  }
  return { host: parsed.hostname.toLowerCase().replace(/^www\./, ''), segments };
}

export function areSiblingPagesOfOneSite(a: SitePage, b: SitePage): boolean {
  if (a.host !== b.host) return false;
  if (a.segments.length === 0 || b.segments.length === 0) return false;
  const shared = Math.min(a.segments.length, b.segments.length);
  for (let index = 0; index < shared; index += 1) {
    if (a.segments[index] !== b.segments[index]) return true;
  }
  return false;
}

export function isPageStatedNameObservation(observation: PageStatedNameObservation): boolean {
  return (
    PAGE_STATED_NAME_FIELDS.has(String(observation.field ?? '')) &&
    PAGE_STATED_NAME_SOURCES.has(String(observation.sourceName ?? '')) &&
    comparablePageStatedName(observation.value) !== '' &&
    sitePage(observation.sourceUrl) !== null
  );
}

/**
 * The names a sibling page of the same site also states for another live row, keyed by
 * `comparablePageStatedName`. `peers` must already exclude this row's own observations
 * and observations of archived rows.
 */
export function siteSharedPageNames(
  candidates: readonly PageStatedNameObservation[],
  peers: readonly PageStatedNameObservation[],
): Set<string> {
  const shared = new Set<string>();
  for (const candidate of candidates) {
    if (!isPageStatedNameObservation(candidate)) continue;
    const name = comparablePageStatedName(candidate.value);
    if (shared.has(name)) continue;
    if (corroboratedLabNameEponyms(candidate.value, candidate.sourceUrl).length > 0) continue;
    const page = sitePage(candidate.sourceUrl) as SitePage;
    const statedBySibling = peers.some((peer) => {
      if (!isPageStatedNameObservation(peer)) return false;
      if (comparablePageStatedName(peer.value) !== name) return false;
      return areSiblingPagesOfOneSite(page, sitePage(peer.sourceUrl) as SitePage);
    });
    if (statedBySibling) shared.add(name);
  }
  return shared;
}

export function withoutNames<T extends PageStatedNameObservation>(
  observations: T[],
  names: ReadonlySet<string>,
): T[] {
  if (names.size === 0) return observations;
  return observations.filter(
    (observation) =>
      !isPageStatedNameObservation(observation) ||
      !names.has(comparablePageStatedName(observation.value)),
  );
}

function belongsToRow(
  observation: PageStatedNameObservation,
  row: { _id?: unknown; slug?: unknown },
): boolean {
  const rowId = row._id === undefined || row._id === null ? '' : String(row._id);
  const observedId =
    observation.entityId === undefined || observation.entityId === null
      ? ''
      : String(observation.entityId);
  if (rowId && observedId === rowId) return true;
  const slug = textValue(row.slug);
  return slug !== '' && textValue(observation.entityKey) === slug;
}

async function liveRowIdentities(peers: PageStatedNameObservation[]): Promise<{
  ids: Set<string>;
  slugs: Set<string>;
}> {
  const ids = [
    ...new Set(
      peers
        .map((peer) => (peer.entityId ? String(peer.entityId) : ''))
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  const slugs = [...new Set(peers.map((peer) => textValue(peer.entityKey)).filter(Boolean))];
  const rows = await ResearchEntity.find({
    archived: { $ne: true },
    $or: [{ _id: { $in: ids } }, { slug: { $in: slugs } }],
  })
    .select('_id slug')
    .lean();
  return {
    ids: new Set(rows.map((row: any) => String(row._id))),
    slugs: new Set(rows.map((row: any) => textValue(row.slug))),
  };
}

const PEER_CACHE_TTL_MS = 5 * 60_000;

let cachedPeersByName: Map<string, PageStatedNameObservation[]> | undefined;
let cachedPeersAt = 0;

export function resetSiteSharedPageNameCache(): void {
  cachedPeersByName = undefined;
  cachedPeersAt = 0;
}

// One load per TTL rather than one unindexed `value` scan per resolve.
async function pageStatedNamePeersByName(
  now: number = Date.now(),
): Promise<Map<string, PageStatedNameObservation[]>> {
  if (cachedPeersByName && now - cachedPeersAt < PEER_CACHE_TTL_MS) return cachedPeersByName;
  const stated = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: [...PAGE_STATED_NAME_FIELDS] },
    superseded: { $ne: true },
    sourceName: { $in: [...PAGE_STATED_NAME_SOURCES] },
  })
    .select('field value sourceName sourceUrl entityKey entityId')
    .lean()) as PageStatedNameObservation[];
  const byName = new Map<string, PageStatedNameObservation[]>();
  for (const observation of stated) {
    const name = comparablePageStatedName(observation.value);
    if (!name) continue;
    const peers = byName.get(name);
    if (peers) peers.push(observation);
    else byName.set(name, [observation]);
  }
  cachedPeersByName = byName;
  cachedPeersAt = now;
  return byName;
}

async function liveCachedPeersOf(
  names: readonly string[],
  row: { _id?: unknown; slug?: unknown },
): Promise<PageStatedNameObservation[]> {
  const peersByName = await pageStatedNamePeersByName();
  const others = [...new Set(names.flatMap((name) => peersByName.get(name) ?? []))].filter(
    (peer) => !belongsToRow(peer, row),
  );
  if (others.length === 0) return [];
  const live = await liveRowIdentities(others);
  return others.filter(
    (peer) =>
      (peer.entityId && live.ids.has(String(peer.entityId))) ||
      live.slugs.has(textValue(peer.entityKey)),
  );
}

export interface SiteSharedPageNameWithdrawal<T> {
  observations: T[];
  withdrawnNames: ReadonlySet<string>;
}

export async function withoutSiteSharedPageNames<T extends PageStatedNameObservation>(
  observations: T[],
  row: { _id?: unknown; slug?: unknown },
  readSource?: MaterializationReadSource,
): Promise<SiteSharedPageNameWithdrawal<T>> {
  const genericHeadings = new Set(
    observations
      .filter(
        (observation) =>
          isPageStatedNameObservation(observation) && isGenericPageHeadingName(observation.value),
      )
      .map((observation) => comparablePageStatedName(observation.value)),
  );
  const unchanged = {
    observations: withoutNames(observations, genericHeadings),
    withdrawnNames: genericHeadings,
  };
  const candidates = unchanged.observations.filter(
    (observation) =>
      isPageStatedNameObservation(observation) &&
      corroboratedLabNameEponyms(observation.value, observation.sourceUrl).length === 0 &&
      (sitePage(observation.sourceUrl) as SitePage).segments.length > 0,
  );
  if (candidates.length === 0) return unchanged;
  const names = [
    ...new Set(candidates.map((candidate) => comparablePageStatedName(candidate.value))),
  ];
  const routed = readSource?.pageStatedNamePeers(names);
  const livePeers = routed?.hit
    ? (routed.value as PageStatedNameObservation[])
    : await liveCachedPeersOf(names, row);
  const withdrawnNames = new Set([
    ...genericHeadings,
    ...siteSharedPageNames(candidates, livePeers),
  ]);
  return { observations: withoutNames(observations, withdrawnNames), withdrawnNames };
}
