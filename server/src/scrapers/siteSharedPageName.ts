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

export const PAGE_STATED_NAME_SOURCES: ReadonlySet<string> = new Set([
  'lab-site-research-read',
  'lab-microsite-description-llm',
]);

const PAGE_STATED_NAME_FIELDS: ReadonlySet<string> = new Set(['name', 'displayName']);

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

export interface SiteSharedPageNameWithdrawal<T> {
  observations: T[];
  withdrawnNames: ReadonlySet<string>;
}

export async function withoutSiteSharedPageNames<T extends PageStatedNameObservation>(
  observations: T[],
  row: { _id?: unknown; slug?: unknown },
): Promise<SiteSharedPageNameWithdrawal<T>> {
  const unchanged = { observations, withdrawnNames: new Set<string>() };
  const candidates = observations.filter(
    (observation) =>
      isPageStatedNameObservation(observation) &&
      corroboratedLabNameEponyms(observation.value, observation.sourceUrl).length === 0 &&
      (sitePage(observation.sourceUrl) as SitePage).segments.length > 0,
  );
  if (candidates.length === 0) return unchanged;
  const values = [
    ...new Set(
      candidates.flatMap((candidate) => [String(candidate.value), textValue(candidate.value)]),
    ),
  ];
  const stated = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: [...PAGE_STATED_NAME_FIELDS] },
    value: { $in: values },
    superseded: { $ne: true },
    sourceName: { $in: [...PAGE_STATED_NAME_SOURCES] },
  })
    .select('field value sourceName sourceUrl entityKey entityId')
    .lean()) as PageStatedNameObservation[];
  const others = stated.filter((peer) => !belongsToRow(peer, row));
  if (others.length === 0) return unchanged;
  const live = await liveRowIdentities(others);
  const livePeers = others.filter(
    (peer) =>
      (peer.entityId && live.ids.has(String(peer.entityId))) ||
      live.slugs.has(textValue(peer.entityKey)),
  );
  const withdrawnNames = siteSharedPageNames(candidates, livePeers);
  return { observations: withoutNames(observations, withdrawnNames), withdrawnNames };
}
