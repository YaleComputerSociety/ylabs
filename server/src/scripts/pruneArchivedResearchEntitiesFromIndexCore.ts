export interface PruneArchivedIndexArgs {
  apply: boolean;
  confirm: boolean;
  pageSize: number;
  output?: string;
}

export const PRUNE_ARCHIVED_INDEX_DEFAULT_PAGE_SIZE = 1000;

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parsePruneArchivedIndexArgs(argv: string[]): PruneArchivedIndexArgs {
  const args: PruneArchivedIndexArgs = {
    apply: false,
    confirm: false,
    pageSize: PRUNE_ARCHIVED_INDEX_DEFAULT_PAGE_SIZE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
    } else if (arg === '--confirm-prune-archived') {
      args.confirm = true;
    } else if (arg.startsWith('--page-size=')) {
      args.pageSize = parsePositiveInteger(arg.slice('--page-size='.length), '--page-size');
    } else if (arg === '--page-size') {
      args.pageSize = parsePositiveInteger(argv[index + 1], '--page-size');
      index += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown prune-archived-index argument: ${arg}`);
    }
  }
  return args;
}

export function assertPruneArchivedIndexApplyAllowed(
  args: PruneArchivedIndexArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error('--confirm-prune-archived is required when --apply is set.');
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `prune-archived-index --apply is restricted to the Development database (target: ${dbLabel}).`,
    );
  }
}

/**
 * A Meili doc is prunable whenever it has no live (non-archived) Mongo
 * counterpart - whether that entity was archived-in-place, re-slugged into a
 * different id, or hard-deleted outright (#1364). Comparing against the full
 * live-id set (rather than only ids Mongo still marks `archived: true`)
 * catches all three cases instead of only the first.
 */
export function computeIndexDocIdsToPrune(
  liveEntityIds: Iterable<string>,
  indexedDocIds: Iterable<string>,
): string[] {
  const live = new Set<string>();
  for (const id of liveEntityIds) live.add(String(id));
  const pruned: string[] = [];
  const emitted = new Set<string>();
  for (const id of indexedDocIds) {
    const key = String(id);
    if (!live.has(key) && !emitted.has(key)) {
      emitted.add(key);
      pruned.push(key);
    }
  }
  return pruned;
}
