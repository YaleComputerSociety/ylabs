import {
  applyObservationPruneEnvironmentGuards,
  applyScraperEnvironmentGuards,
  type ObservationPruneGuardResult,
  type ScraperCommandGuardResult,
} from './scraperEnvironment';
import type { ScraperOptions } from './types';

export interface ScraperCliOutputMetadata {
  command: string;
  environment?: string;
  db?: string;
  options?: Record<string, unknown>;
}

export type ScraperCliPreflight =
  | {
      command: 'run';
      sourceName: string;
      guard: ScraperCommandGuardResult;
    }
  | {
      command: 'cron';
      sourceName: string;
      forceDisabled: boolean;
      guard: ScraperCommandGuardResult;
    }
  | {
      command: 'materialize';
      runId: string;
      confirmMaterialize: boolean;
      guard: ScraperCommandGuardResult;
    }
  | {
      command: 'prune-observations';
      olderThanDays: number;
      keepRuns: number;
      confirmObservationPrune: boolean;
      sourceName?: string;
      guard: ObservationPruneGuardResult;
    }
  | {
      command: string;
    };

const VALUE_FLAGS = new Set([
  'keep-runs',
  'limit',
  'manual-recipient-csv-dir',
  'max-openalex-pages-per-author',
  'offset',
  'older-than-days',
  'only',
  'output',
  'run',
  'since',
  'source',
]);

const BOOLEAN_FLAGS = new Set([
  'apply',
  'auto-materialize',
  'confirm-materialize',
  'confirm-observation-prune',
  'discover-openalex-authors',
  'dry-run',
  'force-disabled',
  'ignore-work-planner',
  'release',
  'use-cache',
]);

export function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
} {
  const command = argv[2] || 'help';
  const flags: Record<string, string | boolean> = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, inlineValue] = a.slice(2).split(/=(.*)/s, 2);
      if (inlineValue !== undefined) {
        if (BOOLEAN_FLAGS.has(key)) {
          throw new Error(`--${key} does not accept a value`);
        }
        if (!inlineValue.trim() || inlineValue.startsWith('--')) {
          throw new Error(`--${key} requires a value`);
        }
        flags[key] = inlineValue;
        continue;
      }
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else if (VALUE_FLAGS.has(key)) {
        throw new Error(`--${key} requires a value`);
      } else {
        flags[key] = true;
      }
    } else {
      throw new Error(`Unknown scraper CLI argument: ${a}`);
    }
  }
  return { command, flags };
}

export function parseScraperOptions(flags: Record<string, string | boolean>): ScraperOptions {
  const options: ScraperOptions = {
    dryRun: !!flags['dry-run'],
    useCache: !!flags['use-cache'] && !flags.release,
    release: !!flags.release,
    limit: parseOptionalIntegerFlag(flags, 'limit', { min: 1, label: 'positive' }),
    offset: parseOptionalIntegerFlag(flags, 'offset', { min: 0, label: 'non-negative' }),
    only:
      typeof flags.only === 'string'
        ? flags.only
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    discoverOpenAlexAuthors: !!flags['discover-openalex-authors'],
    maxOpenAlexPagesPerAuthor: parseOptionalIntegerFlag(
      flags,
      'max-openalex-pages-per-author',
      { min: 1, label: 'positive' },
    ),
    manualRecipientCsvDir:
      typeof flags['manual-recipient-csv-dir'] === 'string'
        ? flags['manual-recipient-csv-dir']
        : undefined,
    ignoreWorkPlanner: !!flags['ignore-work-planner'],
    since: flags.since ? new Date(String(flags.since)) : undefined,
  };

  if (flags.since && Number.isNaN(options.since?.getTime())) {
    throw new Error('--since must be a valid date');
  }

  return options;
}

function parseOptionalIntegerFlag(
  flags: Record<string, string | boolean>,
  name: string,
  options: { min: number; label: 'positive' | 'non-negative' },
): number | undefined {
  if (flags[name] === undefined) return undefined;
  const raw = String(flags[name]).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be a ${options.label} integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`--${name} must be a ${options.label} integer`);
  }
  return value;
}

export function parseIntegerFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
  options: { min: number },
): number {
  if (flags[name] === undefined) return fallback;
  const raw = String(flags[name]).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be an integer greater than or equal to ${options.min}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`--${name} must be an integer greater than or equal to ${options.min}`);
  }
  return value;
}

export function buildMaterializeOutputPayload({
  runId,
  materialization,
  report,
  visibilityGate,
}: {
  runId: string;
  materialization: unknown;
  report: unknown;
  visibilityGate?: unknown;
}): {
  runId: string;
  materialization: unknown;
  visibilityGate?: unknown;
  report: unknown;
} {
  return {
    runId,
    materialization,
    ...(visibilityGate !== undefined ? { visibilityGate } : {}),
    report,
  };
}

export function buildCronOutputPayload<T>(result: T): T {
  return result;
}

export function buildScraperCliOutputPayload<T extends object>(
  payload: T,
  metadata: ScraperCliOutputMetadata,
): T & ScraperCliOutputMetadata {
  return {
    ...payload,
    command: metadata.command,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    ...(metadata.options ? { options: metadata.options } : {}),
  };
}

export function buildScraperCliPreflight(
  command: string,
  flags: Record<string, string | boolean>,
  mongoUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
): ScraperCliPreflight {
  if (command === 'run') {
    const sourceName = flags.source as string;
    if (!sourceName) {
      throw new Error('ERROR: --source <name> is required');
    }
    const options = parseScraperOptions(flags);
    return {
      command,
      sourceName,
      guard: applyScraperEnvironmentGuards({
        command,
        options,
        autoMaterialize: !!flags['auto-materialize'],
        mongoUrl,
        env,
      }),
    };
  }

  if (command === 'cron') {
    const sourceName = flags.source as string;
    if (!sourceName) {
      throw new Error('ERROR: --source <name> is required');
    }
    const options = parseScraperOptions(flags);
    return {
      command,
      sourceName,
      forceDisabled: !!flags['force-disabled'],
      guard: applyScraperEnvironmentGuards({
        command,
        options,
        autoMaterialize: true,
        mongoUrl,
        env,
      }),
    };
  }

  if (command === 'materialize') {
    const runId = flags.run as string;
    if (!runId) {
      throw new Error('ERROR: --run <runId> is required');
    }
    const confirmMaterialize = !!flags['confirm-materialize'];
    const guard = applyScraperEnvironmentGuards({
      command,
      options: {
        dryRun: !!flags['dry-run'],
        useCache: false,
        release: !!flags.release,
      },
      autoMaterialize: false,
      mongoUrl,
      env,
    });
    if (!guard.options.dryRun && !confirmMaterialize) {
      throw new Error('--confirm-materialize is required for scrape materialize write mode.');
    }
    return {
      command,
      runId,
      confirmMaterialize,
      guard,
    };
  }

  if (command === 'prune-observations') {
    const olderThanDays = parseIntegerFlag(flags, 'older-than-days', 30, { min: 1 });
    const keepRuns = parseIntegerFlag(flags, 'keep-runs', 3, { min: 0 });
    const apply = !!flags.apply;
    const confirmObservationPrune = !!flags['confirm-observation-prune'];
    if (apply && !confirmObservationPrune) {
      throw new Error(
        '--confirm-observation-prune is required when --apply is set for scrape prune-observations.',
      );
    }
    return {
      command,
      olderThanDays,
      keepRuns,
      confirmObservationPrune,
      sourceName: typeof flags.source === 'string' ? flags.source : undefined,
      guard: applyObservationPruneEnvironmentGuards({
        apply,
        mongoUrl,
        env,
      }),
    };
  }

  return { command };
}
