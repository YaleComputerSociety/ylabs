/**
 * Re-checks whether each stored description still appears on the page it cites, and
 * records a durable four-way verdict per (row, field, url).
 *
 *   yarn --cwd server research-entity:recheck-description-grounding
 *   yarn --cwd server research-entity:recheck-description-grounding --limit 200 --apply --confirm-description-grounding
 *
 * The write-time guard `isDescriptionGroundedInSource` runs once, at extraction. Nothing
 * re-ran it afterwards, so the corpus kept asserting "this is the page's own wording" on
 * evidence that may since have moved (#2879).
 *
 * The verdict is read by `studentVisibilityTier`, which withholds the
 * `source_backed_description` signal on a fresh `ABSENT`. It deliberately changes no
 * tier: a page that was rewritten does not make the prose it once carried inaccurate.
 *
 * Fetch discipline is not optional here. This issue's first measurement probed at 12-way
 * concurrency with a non-browser user agent, read 1,520 of 2,922 pages as 403, and
 * concluded that half the corpus had drifted; only 13 URLs were genuinely gone. So this
 * pass goes through `probeUncachedUrlsByHost` (serial within a host, parallel only
 * across hosts), sends a browser user agent, and `classifyDescriptionGrounding` cannot
 * return `ABSENT` without a 2xx body.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  classifyDescriptionGrounding,
  type DescriptionGroundingVerdict,
} from '../services/descriptionGrounding';
import {
  checkSourceLinkHealth,
  classifySourceLinkHealth,
  type SourceLinkHealth,
} from '../services/sourceLinkHealth';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { extractOfficialResearchDescription } from '../utils/officialResearchDescription';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  probeUncachedUrlsByHost,
  DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY,
  DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS,
} from './backfillSourceLinkHealth';
import {
  GROUNDED_DESCRIPTION_SOURCE_NAMES,
  descriptionGroundingTargets,
  mergedDescriptionGrounding,
  needsDescriptionGroundingRecheck,
  resolveDescriptionGroundingEntry,
  storedDescriptionGroundingEntry,
  isDecisiveGroundingVerdict,
  type DescriptionGroundingTarget,
} from './recheckDescriptionGroundingCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// A browser user agent, because a WAF answering our scraper string with 403 is the
// mechanism that produced this issue's retracted measurement.
const RECHECK_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RECHECK_FETCH_TIMEOUT_MS = 15_000;

export interface RecheckDescriptionGroundingOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  slugs: string[];
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

function parseSlugList(value: string | undefined): string[] {
  if (!value || value.startsWith('--')) throw new Error('--slugs requires a comma-separated list');
  return value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

export function parseRecheckDescriptionGroundingArgs(
  argv: string[],
): RecheckDescriptionGroundingOptions {
  const options: RecheckDescriptionGroundingOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    slugs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-description-grounding') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[index + 1], '--limit');
      options.explicitLimit = true;
      index += 1;
    } else if (arg.startsWith('--slugs='))
      options.slugs = parseSlugList(arg.slice('--slugs='.length));
    else if (arg === '--slugs') {
      options.slugs = parseSlugList(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown recheck-description-grounding argument: ${arg}`);
  }
  return options;
}

export function assertRecheckDescriptionGroundingApplyAllowed(
  options: Pick<
    RecheckDescriptionGroundingOptions,
    'dryRun' | 'confirm' | 'explicitLimit' | 'slugs'
  >,
): void {
  if (options.dryRun) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-description-grounding.');
  }
  if (!options.explicitLimit && options.slugs.length === 0) {
    throw new Error('Apply mode requires an explicit --limit or --slugs.');
  }
}

interface ProbedPage {
  health: SourceLinkHealth;
  pageText?: string;
  offersResearchProse?: boolean;
}

/**
 * One URL's probe: link health first, then a body read only when the link answered.
 *
 * Returning a `SourceLinkHealth` is what lets this reuse `probeUncachedUrlsByHost`,
 * whose pacing is the measured fix for self-inflicted 403s (#2664). The body is stashed
 * beside it rather than returned, because that dispatcher owns the health cache.
 */
export async function probeDescriptionPage(
  url: string,
  pages: Map<string, ProbedPage>,
  deps: {
    checkLink: (url: string) => Promise<SourceLinkHealth>;
    fetchPage: (url: string) => Promise<{ html: string; status: number }>;
  },
): Promise<SourceLinkHealth> {
  const health = await deps.checkLink(url);
  if (health.healthStatus !== 'HEALTHY' && health.healthStatus !== 'REDIRECTED') {
    pages.set(url, { health });
    return health;
  }
  try {
    const page = await deps.fetchPage(url);
    pages.set(url, {
      health,
      pageText: htmlToText(page.html),
      // Asked of the HTML, because the question is whether the page still offers
      // research prose of ITS OWN - which separates our revoicing from a page whose
      // content moved to a sub-page and left a navigation shell behind.
      offersResearchProse: Boolean(extractOfficialResearchDescription(page.html)),
    });
  } catch (error) {
    void sanitizeLogValue(error);
    const status = Number(
      String((error as Error)?.message || '').match(/status code (\d{3})/)?.[1],
    );
    const bodyHealth = Number.isFinite(status)
      ? classifySourceLinkHealth({ status, requestedUrl: url })
      : { healthStatus: 'UNKNOWN' as const };
    pages.set(url, { health: bodyHealth });
    return bodyHealth;
  }
  return health;
}

export interface RecheckDescriptionGroundingResult {
  mode: 'dry-run' | 'apply';
  rowsWithGroundedLane: number;
  targets: number;
  skippedFresh: number;
  checked: number;
  rowsUpdated: number;
  preservedDecisiveVerdicts: number;
  byVerdict: Record<DescriptionGroundingVerdict, number>;
  /** Rows identified by predicate only: a slug beside a defect judgement is a leak. */
  unsupportedTargets: Array<{ field: string; host: string; storedLength: number }>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

async function main(): Promise<void> {
  const options = parseRecheckDescriptionGroundingArgs(process.argv.slice(2));
  assertRecheckDescriptionGroundingApplyAllowed(options);
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: 'research-entity:recheck-description-grounding',
  });

  mongoose.set('autoIndex', false);
  await initializeConnections();
  const now = new Date();

  const filter: Record<string, unknown> = { archived: { $ne: true } };
  if (options.slugs.length > 0) filter.slug = { $in: options.slugs };
  const rows = (await ResearchEntity.find(filter)
    .select('slug fullDescription shortDescription fieldProvenance descriptionGrounding')
    .lean()) as any[];

  const pending: Array<{ row: any; target: DescriptionGroundingTarget }> = [];
  let rowsWithGroundedLane = 0;
  let skippedFresh = 0;
  for (const row of rows) {
    const targets = descriptionGroundingTargets(row);
    if (targets.length === 0) continue;
    rowsWithGroundedLane += 1;
    for (const target of targets) {
      const stored = storedDescriptionGroundingEntry(row, target);
      if (!needsDescriptionGroundingRecheck(stored, now)) {
        skippedFresh += 1;
        continue;
      }
      pending.push({ row, target });
    }
  }

  const selected =
    options.explicitLimit && options.limit > 0 ? pending.slice(0, options.limit) : pending;

  // The wordings the grounded lane itself asserted, which is what the write-time guard
  // vetted. The served text has been through the sanitizer and the revoice passes, so
  // judging it alone reports our own rewriting as publisher churn.
  const assertedByRowField = new Map<string, string[]>();
  const assertedRows = (await Observation.find({
    entityType: 'researchEntity',
    entityId: { $in: Array.from(new Set(selected.map((item) => item.row._id))) },
    field: { $in: Array.from(new Set(selected.map((item) => item.target.field))) },
    sourceName: { $in: Array.from(GROUNDED_DESCRIPTION_SOURCE_NAMES) },
    superseded: { $ne: true },
  })
    .select('entityId field value')
    .lean()) as any[];
  for (const observation of assertedRows) {
    if (typeof observation.value !== 'string') continue;
    const key = `${String(observation.entityId)}:${observation.field}`;
    const bucket = assertedByRowField.get(key);
    if (bucket) bucket.push(observation.value);
    else assertedByRowField.set(key, [observation.value]);
  }

  const pages = new Map<string, ProbedPage>();
  const healthCache = new Map<string, SourceLinkHealth>();
  const counters = { checked: 0, errors: 0 };
  await probeUncachedUrlsByHost(
    Array.from(new Set(selected.map((item) => item.target.url))),
    healthCache,
    {
      checkLink: (url) =>
        probeDescriptionPage(url, pages, {
          checkLink: checkSourceLinkHealth,
          fetchPage: (target) =>
            fetchPageWithPolicy(target, {
              headers: { 'User-Agent': RECHECK_USER_AGENT },
              timeoutMs: RECHECK_FETCH_TIMEOUT_MS,
            }),
        }),
      hostConcurrency: DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY,
      paceDelayMs: DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      result: counters,
    },
  );

  const result: RecheckDescriptionGroundingResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    rowsWithGroundedLane,
    targets: pending.length,
    skippedFresh,
    checked: 0,
    rowsUpdated: 0,
    preservedDecisiveVerdicts: 0,
    byVerdict: { GROUNDED: 0, REWORDED: 0, UNSUPPORTED: 0, UNREACHABLE: 0, UNKNOWN: 0 },
    unsupportedTargets: [],
  };

  const updatesByRow = new Map<string, { row: any; grounding: unknown }>();
  for (const { row, target } of selected) {
    const probed = pages.get(target.url) || { health: { healthStatus: 'UNKNOWN' as const } };
    const verdict = classifyDescriptionGrounding({
      linkHealth: probed.health,
      pageText: probed.pageText,
      ...(probed.offersResearchProse !== undefined
        ? { pageOffersResearchProse: probed.offersResearchProse }
        : {}),
      candidateDescriptions: [
        target.storedDescription,
        ...(assertedByRowField.get(`${String(row._id)}:${target.field}`) || []),
      ],
    });
    result.checked += 1;
    result.byVerdict[verdict] += 1;
    const stored = storedDescriptionGroundingEntry(row, target);
    if (
      !isDecisiveGroundingVerdict(verdict) &&
      stored &&
      isDecisiveGroundingVerdict(stored.verdict)
    ) {
      result.preservedDecisiveVerdicts += 1;
    }
    if (verdict === 'UNSUPPORTED') {
      result.unsupportedTargets.push({
        field: target.field,
        host: hostOf(target.url),
        storedLength: target.storedDescription.length,
      });
    }
    const entry = resolveDescriptionGroundingEntry({
      target,
      verdict,
      ...(typeof probed.health.httpStatusCode === 'number'
        ? { httpStatusCode: probed.health.httpStatusCode }
        : {}),
      ...(stored ? { stored } : {}),
      now,
    });
    const key = String(row._id);
    const current = updatesByRow.get(key)?.grounding ?? row.descriptionGrounding;
    updatesByRow.set(key, { row, grounding: mergedDescriptionGrounding(current, entry) });
  }

  if (!options.dryRun) {
    for (const [id, update] of updatesByRow) {
      await ResearchEntity.updateOne(
        { _id: id },
        { $set: { descriptionGrounding: update.grounding } },
        { timestamps: false },
      );
      result.rowsUpdated += 1;
    }
  } else {
    result.rowsUpdated = updatesByRow.size;
  }

  console.log(JSON.stringify(result, null, 2));
  if (options.output) {
    fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
    console.log(`report -> ${sanitizeLogValue(options.output)}`);
  }
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
