import { describe, expect, it } from 'vitest';
import {
  assertPruneArchivedIndexApplyAllowed,
  computeIndexDocIdsToPrune,
  parsePruneArchivedIndexArgs,
  PRUNE_ARCHIVED_INDEX_DEFAULT_PAGE_SIZE,
} from '../pruneArchivedResearchEntitiesFromIndexCore';

describe('parsePruneArchivedIndexArgs', () => {
  it('defaults to a guarded dry-run', () => {
    const args = parsePruneArchivedIndexArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.pageSize).toBe(PRUNE_ARCHIVED_INDEX_DEFAULT_PAGE_SIZE);
  });

  it('parses apply, confirm, and page-size flags', () => {
    const args = parsePruneArchivedIndexArgs([
      '--apply',
      '--confirm-prune-archived',
      '--page-size=250',
    ]);
    expect(args.apply).toBe(true);
    expect(args.confirm).toBe(true);
    expect(args.pageSize).toBe(250);
  });

  it('rejects a non-positive page size', () => {
    expect(() => parsePruneArchivedIndexArgs(['--page-size=0'])).toThrow(/positive integer/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parsePruneArchivedIndexArgs(['--nope'])).toThrow(/Unknown/);
  });
});

describe('assertPruneArchivedIndexApplyAllowed', () => {
  it('is a no-op in dry-run mode', () => {
    expect(() =>
      assertPruneArchivedIndexApplyAllowed(
        { apply: false, confirm: false, pageSize: 1000 },
        'cluster/Production',
      ),
    ).not.toThrow();
  });

  it('requires the confirm flag when applying', () => {
    expect(() =>
      assertPruneArchivedIndexApplyAllowed(
        { apply: true, confirm: false, pageSize: 1000 },
        'cluster/Development',
      ),
    ).toThrow(/--confirm-prune-archived/);
  });

  it('restricts apply to the Development database', () => {
    expect(() =>
      assertPruneArchivedIndexApplyAllowed(
        { apply: true, confirm: true, pageSize: 1000 },
        'cluster/Beta',
      ),
    ).toThrow(/Development/);
  });

  it('allows a confirmed Development apply', () => {
    expect(() =>
      assertPruneArchivedIndexApplyAllowed(
        { apply: true, confirm: true, pageSize: 1000 },
        'yalelabs.mongodb.net/Development',
      ),
    ).not.toThrow();
  });
});

describe('computeIndexDocIdsToPrune', () => {
  it('returns indexed docs that have no live entity counterpart', () => {
    const live = ['x', 'y'];
    const indexed = ['x', 'd', 'y', 'e'];
    expect(computeIndexDocIdsToPrune(live, indexed)).toEqual(['d', 'e']);
  });

  it('prunes a doc whose entity was hard-deleted, not just archived-in-place (#1364)', () => {
    // The entity behind "d" no longer exists in Mongo at all - it never
    // appears in the live-id set - but its Meili doc still lingers.
    const live = ['a', 'b'];
    const indexed = ['a', 'b', 'd'];
    expect(computeIndexDocIdsToPrune(live, indexed)).toEqual(['d']);
  });

  it('never prunes a live id that is absent from the index', () => {
    expect(computeIndexDocIdsToPrune(['x', 'y'], ['x'])).toEqual([]);
  });

  it('dedupes repeated index doc ids', () => {
    expect(computeIndexDocIdsToPrune(['a'], ['b', 'b', 'b'])).toEqual(['b']);
  });

  it('coerces mixed id types to strings before comparing', () => {
    expect(computeIndexDocIdsToPrune([1 as unknown as string], ['2'])).toEqual(['2']);
  });
});
