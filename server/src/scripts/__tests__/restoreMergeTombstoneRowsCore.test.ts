import { describe, expect, it } from 'vitest';
import {
  buildMergeTombstoneRestorePlan,
  tombstoneNameFromSlug,
  type ExistingRowProbe,
  type MergeRedirectRecord,
} from '../restoreMergeTombstoneRowsCore';

const LIVE_CANONICAL = 'aaaaaaaaaaaaaaaaaaaaaaa1';

function planFor(
  redirects: MergeRedirectRecord[],
  rows: Record<string, ExistingRowProbe> = {},
  options: { freeIds?: string[]; canonicalBySlug?: Record<string, string | undefined> } = {},
) {
  const freeIds = new Set(options.freeIds ?? []);
  return buildMergeTombstoneRestorePlan({
    redirects,
    probes: {
      rowBySlug: (slug) => rows[slug],
      idIsFree: (id) => freeIds.has(id),
      liveCanonicalIdFor: (redirect) =>
        options.canonicalBySlug
          ? options.canonicalBySlug[redirect.mergedSlug ?? '']
          : LIVE_CANONICAL,
    },
  });
}

describe('buildMergeTombstoneRestorePlan', () => {
  it('restores a deleted shell at its original id when that id is free', () => {
    const summary = planFor(
      [{ mergedSlug: 'example-shell', mergedEntityId: 'bbbbbbbbbbbbbbbbbbbbbbb2' }],
      {},
      { freeIds: ['bbbbbbbbbbbbbbbbbbbbbbb2'] },
    );

    expect(summary.plans).toEqual([
      {
        mergedSlug: 'example-shell',
        action: 'restore_deleted_shell',
        canonicalEntityId: LIVE_CANONICAL,
        restoreEntityId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
      },
    ]);
    expect(summary.plannedByAction.restore_deleted_shell).toBe(1);
  });

  it('restores without reusing an id another row has taken', () => {
    const summary = planFor([
      { mergedSlug: 'example-shell', mergedEntityId: 'bbbbbbbbbbbbbbbbbbbbbbb2' },
    ]);

    expect(summary.plans[0].action).toBe('restore_deleted_shell');
    expect(summary.plans[0].restoreEntityId).toBeUndefined();
  });

  it('mints a tombstone for a stranded key that never had a row', () => {
    const summary = planFor([{ mergedSlug: 'example-stranded-key' }]);

    expect(summary.plans[0].action).toBe('mint_stranded_key_tombstone');
    expect(summary.plannedByAction.mint_stranded_key_tombstone).toBe(1);
  });

  it('stamps a tombstone onto an archived row that lost its canonicalGroupId', () => {
    const summary = planFor([{ mergedSlug: 'example-shell' }], {
      'example-shell': { id: 'ccccccccccccccccccccccc3', archived: true },
    });

    expect(summary.plans[0]).toMatchObject({
      action: 'stamp_missing_tombstone',
      existingRowId: 'ccccccccccccccccccccccc3',
    });
  });

  it('skips a row that already carries the tombstone', () => {
    const summary = planFor([{ mergedSlug: 'example-shell' }], {
      'example-shell': {
        id: 'ccccccccccccccccccccccc3',
        archived: true,
        canonicalGroupId: LIVE_CANONICAL,
      },
    });

    expect(summary.plans).toEqual([]);
    expect(summary.skippedByReason.tombstone_already_correct).toBe(1);
  });

  it('never touches a live row that holds the slug', () => {
    const summary = planFor([{ mergedSlug: 'example-shell' }], {
      'example-shell': { id: 'ccccccccccccccccccccccc3', archived: false },
    });

    expect(summary.plans).toEqual([]);
    expect(summary.skippedByReason.live_row_holds_slug).toBe(1);
  });

  it('refuses to create a tombstone whose chain reaches no live canonical', () => {
    const summary = planFor([{ mergedSlug: 'example-shell' }], {}, { canonicalBySlug: {} });

    expect(summary.plans).toEqual([]);
    expect(summary.skippedByReason.no_live_canonical).toBe(1);
  });

  it('creates one tombstone when two redirects name the same slug', () => {
    const summary = planFor([
      { mergedSlug: 'example-shell', mergedEntityId: 'bbbbbbbbbbbbbbbbbbbbbbb2' },
      { mergedSlug: 'example-shell', mergedEntityId: 'ddddddddddddddddddddddd4' },
    ]);

    expect(summary.plans).toHaveLength(1);
  });

  it('counts a redirect carrying no slug rather than dropping it silently', () => {
    const summary = planFor([{ mergedEntityId: 'bbbbbbbbbbbbbbbbbbbbbbb2' }]);

    expect(summary.scanned).toBe(1);
    expect(summary.plans).toEqual([]);
    expect(summary.skippedByReason.no_merged_slug).toBe(1);
  });

  it('accounts for every scanned redirect in exactly one bucket', () => {
    const summary = planFor([{ mergedSlug: 'a' }, { mergedSlug: 'b' }, { mergedSlug: 'c' }, {}], {
      b: { id: 'x', archived: true, canonicalGroupId: LIVE_CANONICAL },
      c: { id: 'y', archived: false },
    });

    expect(summary.plans.length + summary.skipped.length).toBe(summary.scanned);
  });
});

describe('tombstoneNameFromSlug', () => {
  it('derives a non-empty name so a minted tombstone passes schema validation', () => {
    expect(tombstoneNameFromSlug('faculty-research-area-example-lead')).toBe(
      'Faculty Research Area Example Lead',
    );
  });

  it('falls back to the slug when it carries no words', () => {
    expect(tombstoneNameFromSlug('---')).toBe('---');
  });
});
