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
  it('returns only indexed docs whose entity is archived', () => {
    const archived = ['a', 'b', 'c'];
    const indexed = ['b', 'd', 'a', 'e'];
    expect(computeIndexDocIdsToPrune(archived, indexed)).toEqual(['b', 'a']);
  });

  it('never returns an archived id that is absent from the index', () => {
    expect(computeIndexDocIdsToPrune(['x', 'y'], ['z'])).toEqual([]);
  });

  it('dedupes repeated index doc ids', () => {
    expect(computeIndexDocIdsToPrune(['a'], ['a', 'a', 'a'])).toEqual(['a']);
  });

  it('coerces mixed id types to strings before comparing', () => {
    expect(computeIndexDocIdsToPrune([1 as unknown as string], ['1'])).toEqual(['1']);
  });
});
