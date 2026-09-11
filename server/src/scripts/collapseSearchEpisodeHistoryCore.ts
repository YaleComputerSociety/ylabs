/**
 * Plans the one-time collapse of search events recorded before the episode fold
 * existed.
 *
 * The rows already in `analytics_events` were written once per HTTP request, so
 * the report lists every keystroke pause a student made and every page of a
 * result walk. This replays the live fold over that history and reports which
 * row survives each episode, so the plan can be read before anything is deleted.
 *
 * The decisions come from `services/searchEpisode` rather than being restated
 * here: a second copy would let the collapsed history disagree with what the
 * serve path now records.
 */
import {
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
}

export interface CollapsedEpisode {
  netid: string;
  surface: string;
  keepId: string;
  keepQuery: string;
  keepResultCount: number | null;
  deleteIds: string[];
  trail: string[];
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

export function planSearchEpisodeCollapse(rows: SearchEventRow[]): SearchEpisodeCollapsePlan {
  const ordered = [...rows].sort(
    (left, right) =>
      left.netid.localeCompare(right.netid) || left.timestamp.getTime() - right.timestamp.getTime(),
  );

  const pagedDeleteIds = ordered.filter(isPagedRow).map((row) => row.id);
  const searchRows = ordered.filter((row) => !isPagedRow(row));

  const openByNetid = new Map<string, Array<{ rows: SearchEventRow[]; lastAt: number }>>();
  const episodes: Array<{ netid: string; rows: SearchEventRow[] }> = [];

  for (const row of searchRows) {
    const open = openByNetid.get(row.netid) ?? [];
    if (!openByNetid.has(row.netid)) openByNetid.set(row.netid, open);

    const at = row.timestamp.getTime();
    const candidate = [...open].reverse().find(
      (episode) =>
        at - episode.lastAt <= SEARCH_EPISODE_WINDOW_MS &&
        continuesSearchEpisode(
          episode.rows[episode.rows.length - 1],
          { searchQuery: row.searchQuery ?? '', metadata: row.metadata },
          // History predates the per-surface flag, so the surface it was
          // recorded on decides, exactly as it does on the write path.
          searchEpisodeSurface(row.metadata) === 'program',
        ),
    );

    if (candidate) {
      candidate.rows.push(row);
      candidate.lastAt = at;
      continue;
    }

    const episode = { netid: row.netid, rows: [row] };
    open.push({ rows: episode.rows, lastAt: at });
    episodes.push(episode);
  }

  const collapsed: CollapsedEpisode[] = [];
  const survivors: SearchEventRow[] = [];

  for (const episode of episodes) {
    const keep = episode.rows.reduce((best, row) =>
      isFullerSearchEpisodeQuery(row.searchQuery ?? '', best.searchQuery ?? '') ||
      (normalizeSearchEpisodeQuery(row.searchQuery).length ===
        normalizeSearchEpisodeQuery(best.searchQuery).length &&
        row.timestamp.getTime() > best.timestamp.getTime())
        ? row
        : best,
    );
    survivors.push(keep);

    if (episode.rows.length === 1) continue;

    collapsed.push({
      netid: episode.netid,
      surface: searchEpisodeSurface(keep.metadata),
      keepId: keep.id,
      keepQuery: keep.searchQuery ?? '',
      keepResultCount: resultCountOf(keep),
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
