import type { ScraperEnvironment } from '../scrapers/scraperEnvironment';

export interface PruneDeadObservationsArgs {
  apply: boolean;
  confirm: boolean;
  dropSnapshotCache: boolean;
  keepRuns?: number;
  sourceName?: string;
  output?: string;
}

export const PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG = '--confirm-prune-dead-observations';

export function parsePruneDeadObservationsArgs(argv: string[]): PruneDeadObservationsArgs {
  const args: PruneDeadObservationsArgs = {
    apply: false,
    confirm: false,
    dropSnapshotCache: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
    } else if (arg === PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG) {
      args.confirm = true;
    } else if (arg === '--drop-snapshot-cache') {
      args.dropSnapshotCache = true;
    } else if (arg.startsWith('--keep-runs=')) {
      args.keepRuns = parseKeepRuns(arg.slice('--keep-runs='.length));
    } else if (arg === '--keep-runs') {
      args.keepRuns = parseKeepRuns(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--source=')) {
      args.sourceName = arg.slice('--source='.length);
    } else if (arg === '--source') {
      args.sourceName = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown prune-dead-observations argument: ${arg}`);
    }
  }
  return args;
}

function parseKeepRuns(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--keep-runs requires a non-negative integer; received ${raw}`);
  }
  return value;
}

export function assertPruneDeadObservationsApplyAllowed(
  args: PruneDeadObservationsArgs,
  dbLabel: string,
  environment: ScraperEnvironment,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`${PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG} is required when --apply is set.`);
  }
  if (environment === 'production' || /\/(prod|production)$/i.test(dbLabel)) {
    throw new Error(
      `prune-dead-observations --apply is blocked against a production database (environment: ${environment}, target: ${dbLabel}).`,
    );
  }
}
