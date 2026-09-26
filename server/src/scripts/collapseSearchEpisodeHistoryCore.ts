/**
 * Plans the one-time collapse of search events recorded before the episode fold
 * existed.
 *
 * The rows already in `analytics_events` were written once per HTTP request, so
 * the report lists every keystroke pause a student made and every page of a
 * result walk. This replays the live fold over that history and reports which
 * row survives each episode and what its episode times become, so the plan can be
 * read before anything is written or deleted.
 *
 * The decisions come from `services/searchEpisode` rather than being restated
 * here: a second copy would let the collapsed history disagree with what the
 * serve path now records.
 */
import {
  SEARCH_EPISODE_MAX_SPAN_MS,
  SEARCH_EPISODE_WINDOW_MS,
  continuesSearchEpisode,
  isFullerSearchEpisodeQuery,
  normalizeSearchEpisodeQuery,
  searchEpisodeSurface,
} from '../services/searchEpisode';

export interface SearchEventRow {
  id: string;
  netid: string;
  searchQuery?: string | null;
  metadata?: unknown;
  timestamp: Date;
  searchEpisodeUpdatedAt?: Date | null;
}

export interface CollapsedEpisode {
  netid: string;
  surface: string;
  keepId: string;
  keepQuery: string;
  keepResultCount: number | null;
  keepTimestamp: Date;
  keepEpisodeUpdatedAt: Date;
  deleteIds: string[];
  trail: string[];
}

/**
 * The surviving row's episode times, which the collapse has to write rather than
 * infer: the row it keeps is often not the episode's first snapshot, and search
 * attribution counts only the actions recorded after a search's timestamp, so
 * leaving the later timestamp in place would orphan an entity open that already
 * followed the episode's earlier snapshot.
 */
export interface SearchEpisodeKeepRewrite {
  id: string;
  timestamp: Date;
  searchEpisodeUpdatedAt: Date;
}

export interface SearchEpisodeCollapsePlan {
  scanned: number;
  keptCount: number;
  episodes: CollapsedEpisode[];
  pagedDeleteIds: string[];
  distinctQueriesBefore: number;
  distinctQueriesAfter: number;
  zeroResultRowsBefore: number;
  zeroResultRowsAfter: number;
}

const resultCountOf = (row: SearchEventRow): number | null => {
  const value = (row.metadata as { resultCount?: unknown } | undefined)?.resultCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const pageOf = (row: SearchEventRow): number | null => {
  const value = (row.metadata as { page?: unknown } | undefined)?.page;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * A page past the first was never a search of its own: the programs surface
 * walks every page of a result set in a loop, so these rows counted one search
 * as many times as the set had pages.
 */
const isPagedRow = (row: SearchEventRow): boolean => (pageOf(row) ?? 1) > 1;

const isZeroResult = (row: SearchEventRow): boolean => (resultCountOf(row) ?? 0) <= 0;

const lastSnapshotAt = (row: SearchEventRow): number =>
  (row.searchEpisodeUpdatedAt ?? row.timestamp).getTime();

interface OpenEpisode {
  netid: string;
  rows: SearchEventRow[];
  keep: SearchEventRow;
  firstAt: number;
  lastAt: number;
}

/**
 * The row the live fold would be comparing against, which is the episode's
 * surviving snapshot rather than its latest: an edit is folded in place, so the
 * stored query is the fullest one so far. Subsequence containment is not
 * transitive, so comparing against the latest snapshot instead would fold a third
 * lookup the live rule keeps apart.
 */
const keeperOf = (episode: OpenEpisode, row: SearchEventRow): SearchEventRow =>
  isFullerSearchEpisodeQuery(row.searchQuery ?? '', episode.keep.searchQuery ?? '') ||
  (normalizeSearchEpisodeQuery(row.searchQuery).length ===
    normalizeSearchEpisodeQuery(episode.keep.searchQuery).length &&
    row.timestamp.getTime() > episode.keep.timestamp.getTime())
    ? row
    : episode.keep;

const continuesOpenEpisode = (episode: OpenEpisode, row: SearchEventRow): boolean => {
  const at = row.timestamp.getTime();
  const sinceLastSnapshot = at - episode.lastAt;
  if (sinceLastSnapshot < 0 || sinceLastSnapshot > SEARCH_EPISODE_WINDOW_MS) return false;
  if (at - episode.firstAt > SEARCH_EPISODE_MAX_SPAN_MS) return false;
  return continuesSearchEpisode(
    episode.keep,
    { searchQuery: row.searchQuery ?? '', metadata: row.metadata },
    // History predates the per-surface flag, so the surface it was
    // recorded on decides, exactly as it does on the write path.
    searchEpisodeSurface(row.metadata) === 'program',
  );
};

export function planSearchEpisodeCollapse(rows: SearchEventRow[]): SearchEpisodeCollapsePlan {
  const ordered = [...rows].sort(
    (left, right) =>
      left.netid.localeCompare(right.netid) || left.timestamp.getTime() - right.timestamp.getTime(),
  );

  const pagedDeleteIds = ordered.filter(isPagedRow).map((row) => row.id);
  const searchRows = ordered.filter((row) => !isPagedRow(row));

  const openByNetid = new Map<string, OpenEpisode[]>();
  const episodes: OpenEpisode[] = [];

  for (const row of searchRows) {
    const open = openByNetid.get(row.netid) ?? [];
    if (!openByNetid.has(row.netid)) openByNetid.set(row.netid, open);

    const candidate = [...open].reverse().find((episode) => continuesOpenEpisode(episode, row));

    if (candidate) {
      candidate.rows.push(row);
      candidate.keep = keeperOf(candidate, row);
      candidate.lastAt = Math.max(candidate.lastAt, lastSnapshotAt(row));
      continue;
    }

    const episode: OpenEpisode = {
      netid: row.netid,
      rows: [row],
      keep: row,
      firstAt: row.timestamp.getTime(),
      lastAt: lastSnapshotAt(row),
    };
    open.push(episode);
    episodes.push(episode);
  }

  const collapsed: CollapsedEpisode[] = [];
  const survivors: SearchEventRow[] = [];

  for (const episode of episodes) {
    const keep = episode.keep;
    survivors.push(keep);

    if (episode.rows.length === 1) continue;

    collapsed.push({
      netid: episode.netid,
      surface: searchEpisodeSurface(keep.metadata),
      keepId: keep.id,
      keepQuery: keep.searchQuery ?? '',
      keepResultCount: resultCountOf(keep),
      keepTimestamp: new Date(episode.firstAt),
      keepEpisodeUpdatedAt: new Date(episode.lastAt),
      deleteIds: episode.rows.filter((row) => row.id !== keep.id).map((row) => row.id),
      trail: episode.rows.map(
        (row) => `${JSON.stringify(row.searchQuery ?? '')}@${row.timestamp.toISOString()}`,
      ),
    });
  }

  return {
    scanned: rows.length,
    keptCount: survivors.length,
    episodes: collapsed,
    pagedDeleteIds,
    distinctQueriesBefore: new Set(
      ordered.map((row) => normalizeSearchEpisodeQuery(row.searchQuery)),
    ).size,
    distinctQueriesAfter: new Set(
      survivors.map((row) => normalizeSearchEpisodeQuery(row.searchQuery)),
    ).size,
    zeroResultRowsBefore: ordered.filter(isZeroResult).length,
    zeroResultRowsAfter: survivors.filter(isZeroResult).length,
  };
}

export const collapseDeleteIds = (plan: SearchEpisodeCollapsePlan): string[] => [
  ...plan.episodes.flatMap((episode) => episode.deleteIds),
  ...plan.pagedDeleteIds,
];

export const collapseKeepRewrites = (plan: SearchEpisodeCollapsePlan): SearchEpisodeKeepRewrite[] =>
  plan.episodes.map((episode) => ({
    id: episode.keepId,
    timestamp: episode.keepTimestamp,
    searchEpisodeUpdatedAt: episode.keepEpisodeUpdatedAt,
  }));
