import { describe, expect, it } from 'vitest';

import {
  collapseDeleteIds,
  collapseKeepRewrites,
  planSearchEpisodeCollapse,
  type SearchEventRow,
} from '../collapseSearchEpisodeHistoryCore';
import {
  assertCollapseSearchEpisodesApplyAllowed,
  parseCollapseSearchEpisodesArgs,
} from '../collapseSearchEpisodeHistory';

const at = (seconds: number): Date => new Date(Date.UTC(2026, 8, 7, 12, 0, seconds));

const row = (
  id: string,
  searchQuery: string,
  seconds: number,
  metadata: Record<string, unknown> = {},
): SearchEventRow => ({
  id,
  netid: 'teststud1',
  searchQuery,
  timestamp: at(seconds),
  metadata: { entityType: 'program', resultCount: 0, filters: {}, page: 1, ...metadata },
});

describe('planSearchEpisodeCollapse', () => {
  it('keeps the fullest query of a typed episode and deletes the snapshots', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'mechengineering', 0),
      row('b', 'mechaniengineering', 1),
      row('c', 'mechanicaengineering', 2),
      row('d', 'mechanical engineering', 3, { resultCount: 32 }),
    ]);

    expect(plan.episodes).toHaveLength(1);
    expect(plan.episodes[0]).toMatchObject({
      keepId: 'd',
      keepQuery: 'mechanical engineering',
      keepResultCount: 32,
      deleteIds: ['a', 'b', 'c'],
    });
    expect(collapseDeleteIds(plan)).toEqual(['a', 'b', 'c']);
  });

  it('gives the surviving row the episode span, not its own later timestamp', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'mechengineering', 0),
      row('b', 'mechanicaengineering', 2),
      row('c', 'mechanical engineering', 3, { resultCount: 32 }),
    ]);

    expect(plan.episodes[0]).toMatchObject({
      keepId: 'c',
      keepTimestamp: at(0),
      keepEpisodeUpdatedAt: at(3),
    });
    expect(collapseKeepRewrites(plan)).toEqual([
      { id: 'c', timestamp: at(0), searchEpisodeUpdatedAt: at(3) },
    ]);
  });

  it('compares a later snapshot against the query the row survives with', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'rosenfeld', 0, { resultCount: 1 }),
      row('b', 'rose', 2),
      row('c', 'rosemary', 4),
    ]);

    expect(plan.episodes).toHaveLength(1);
    expect(plan.episodes[0]).toMatchObject({ keepId: 'a', deleteIds: ['b'] });
    expect(collapseDeleteIds(plan)).toEqual(['b']);
    expect(plan.keptCount).toBe(2);
  });

  it('windows a row the live fold already folded from its last snapshot', () => {
    const plan = planSearchEpisodeCollapse([
      { ...row('a', 'rosenfeld', 0, { resultCount: 1 }), searchEpisodeUpdatedAt: at(20) },
      row('b', 'rosenfeld lab', 30, { resultCount: 2 }),
    ]);

    expect(plan.episodes).toHaveLength(1);
    expect(plan.episodes[0]).toMatchObject({
      keepId: 'b',
      keepTimestamp: at(0),
      keepEpisodeUpdatedAt: at(30),
      deleteIds: ['a'],
    });
  });

  it('starts a new episode once the episode span cap is reached', () => {
    const everyTenSeconds = Array.from({ length: 70 }, (_, index) =>
      row(`r${index}`, 'econ', index * 10, { resultCount: 12 }),
    );

    const plan = planSearchEpisodeCollapse(everyTenSeconds);

    expect(plan.episodes).toHaveLength(2);
    expect(plan.keptCount).toBe(2);
    expect(plan.episodes[0]).toMatchObject({ keepId: 'r60', keepTimestamp: at(0) });
    expect(plan.episodes[1]).toMatchObject({ keepId: 'r69', keepTimestamp: at(610) });
  });

  it('keeps the query rather than the backspace that followed it', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'rosenfeld', 0, { resultCount: 1 }),
      row('b', 'rosenfel', 3),
    ]);

    expect(plan.episodes[0]).toMatchObject({
      keepId: 'a',
      keepQuery: 'rosenfeld',
      keepResultCount: 1,
      deleteIds: ['b'],
    });
  });

  it('keeps the query and its coverage gap rather than a shorter fragment that matched', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'math', 0),
      row('b', 'm', 7, { resultCount: 5 }),
      row('c', 'ma', 8, { resultCount: 5 }),
      row('d', 'm', 10, { resultCount: 5 }),
    ]);

    expect(plan.episodes[0]).toMatchObject({ keepId: 'a', keepQuery: 'math', keepResultCount: 0 });
    expect(plan.zeroResultRowsAfter).toBe(1);
  });

  it('deletes a page past the first without treating it as an episode', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'fellowship', 0, { resultCount: 74 }),
      row('b', 'fellowship', 1, { resultCount: 74, page: 2 }),
      row('c', 'fellowship', 2, { resultCount: 74, page: 3 }),
    ]);

    expect(plan.pagedDeleteIds).toEqual(['b', 'c']);
    expect(plan.episodes).toHaveLength(0);
    expect(plan.keptCount).toBe(1);
  });

  it('keeps two deliberate lookups and two different filter sets apart', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'rosen', 0),
      row('b', 'goldwater', 2),
      row('c', '', 4, { filters: { globalRegions: ['Africa'] } }),
      row('d', '', 6, { filters: { globalRegions: ['Asia'] } }),
    ]);

    expect(plan.episodes).toHaveLength(0);
    expect(collapseDeleteIds(plan)).toEqual([]);
    expect(plan.keptCount).toBe(4);
  });

  it('never folds an edit recorded on a surface that does not debounce', () => {
    const research = { entityType: 'research_entity' };
    const plan = planSearchEpisodeCollapse([
      row('a', 'quantum materials physics', 0, research),
      row('b', 'quantum materials', 3, { ...research, resultCount: 12 }),
    ]);

    expect(plan.episodes).toHaveLength(0);
    expect(plan.zeroResultRowsAfter).toBe(1);
  });

  it('leaves an episode alone once the window has passed', () => {
    const plan = planSearchEpisodeCollapse([row('a', 'eco', 0), row('b', 'econ', 40)]);

    expect(plan.episodes).toHaveLength(0);
  });

  it('reports the before and after shape of the report', () => {
    const plan = planSearchEpisodeCollapse([
      row('a', 'eco', 0),
      row('b', 'econ', 1, { resultCount: 12 }),
      row('c', 'econ', 2, { resultCount: 12, page: 2 }),
    ]);

    expect(plan).toMatchObject({
      scanned: 3,
      keptCount: 1,
      distinctQueriesBefore: 2,
      distinctQueriesAfter: 1,
      zeroResultRowsBefore: 1,
      zeroResultRowsAfter: 0,
    });
  });
});

describe('collapse apply guards', () => {
  it('refuses to delete without the confirm flag', () => {
    expect(() =>
      assertCollapseSearchEpisodesApplyAllowed(
        { apply: true, confirmSearchEpisodeCollapse: false, snapshot: '/tmp/snap.json' },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/development',
      ),
    ).toThrow(/--confirm-search-episode-collapse is required/);
  });

  it('refuses to delete without a snapshot to restore from', () => {
    expect(() =>
      assertCollapseSearchEpisodesApplyAllowed(
        { apply: true, confirmSearchEpisodeCollapse: true, snapshot: undefined },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/development',
      ),
    ).toThrow(/--snapshot is required/);
  });

  it('refuses a production target that the environment does not admit to', () => {
    expect(() =>
      assertCollapseSearchEpisodesApplyAllowed(
        { apply: true, confirmSearchEpisodeCollapse: true, snapshot: '/tmp/snap.json' },
        { SCRAPER_ENV: 'development' },
        'mongodb://cluster.example.net/production',
      ),
    ).toThrow(/looks like production/);
  });

  it('allows a dry run against anything', () => {
    expect(() =>
      assertCollapseSearchEpisodesApplyAllowed(
        { apply: false, confirmSearchEpisodeCollapse: false, snapshot: undefined },
        { SCRAPER_ENV: 'development' },
        'mongodb://cluster.example.net/production',
      ),
    ).not.toThrow();
  });

  it('rejects an artifact path outside the temp roots', () => {
    expect(() => parseCollapseSearchEpisodesArgs(['--snapshot', '/etc/snap.json'])).toThrow(
      /--snapshot must write under/,
    );
    expect(() => parseCollapseSearchEpisodesArgs(['--snapshot=/tmp/snap.txt'])).toThrow(
      /--snapshot must point to a .json report file/,
    );
  });

  it('parses the flags it documents and rejects the rest', () => {
    expect(
      parseCollapseSearchEpisodesArgs(['--apply', '--confirm-search-episode-collapse']),
    ).toMatchObject({ apply: true, confirmSearchEpisodeCollapse: true });
    expect(() => parseCollapseSearchEpisodesArgs(['--wat'])).toThrow(/Unknown/);
  });
});
