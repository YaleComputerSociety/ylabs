/**
 * Records that a `websiteUrl` a row's corpus still asserts is inadmissible because the
 * page is gone, and withdraws that record when a later probe shows it answering (#3191).
 *
 * The rows this is for were cleared correctly. 7 of the 18 that still freeze
 * `websiteUrl` hold a value that returns 404 or 410, and the freeze is the only thing
 * stopping the engine re-deriving the dead link from a live observation. That is
 * #2612's shape with the clear being right, so the fix is to make the correction
 * durable and let the lock go, not to keep the row frozen.
 *
 * `deadWebsiteValueRefusalCore` owns the verdict and is deliberately stricter than
 * `classifySourceLinkHealth`: only the server's own 404 or 410 counts. This runner owns
 * the probing and the writes.
 *
 * Probing is serial with a pause between requests, because a parallel audit collects
 * 403s from a WAF rather than dead pages and then reads them as death (#2570). The
 * probe itself is `probeSourceLink`, which carries the repo's user agent and its egress
 * guard, so nothing here re-implements fetching.
 *
 * Usage:
 *   yarn --cwd server research-entity:refuse-dead-website-values
 *   yarn --cwd server research-entity:refuse-dead-website-values --slug=<slug> --apply \
 *     --confirm-dead-website-value-refusal
 *   yarn --cwd server research-entity:refuse-dead-website-values --revive --apply \
 *     --confirm-dead-website-value-refusal
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { probeSourceLink } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
} from '../utils/researchEntityFieldValueRefusals';
import {
  DEAD_WEBSITE_VALUE_REFUSAL_RULE,
  deadValueRefusalNote,
  deadValueRefusalVerdict,
  revivedValueWithdrawal,
} from './deadWebsiteValueRefusalCore';
import { resolveFieldLockReleases } from './releaseRevisitableFieldLocksCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:refuse-dead-website-values';
const PROBE_PAUSE_MS = 2500;

export interface RefuseDeadWebsiteValuesArgs {
  slugs: string[];
  revive: boolean;
  allClearedRows: boolean;
  apply: boolean;
  confirm: boolean;
  limit?: number;
  output?: string;
}

export function parseRefuseDeadWebsiteValuesArgs(argv: string[]): RefuseDeadWebsiteValuesArgs {
  const args: RefuseDeadWebsiteValuesArgs = {
    slugs: [],
    revive: false,
    allClearedRows: false,
    apply: false,
    confirm: false,
  };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-dead-website-value-refusal') args.confirm = true;
    else if (arg === '--revive') args.revive = true;
    else if (arg === '--all-cleared-rows') args.allClearedRows = true;
    else if (arg.startsWith('--slug=')) args.slugs.push(arg.slice('--slug='.length).trim());
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  args.slugs = [...new Set(args.slugs.filter(Boolean))];
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} --apply requires --confirm-dead-website-value-refusal.`);
  }
  if (args.limit !== undefined && !Number.isSafeInteger(args.limit)) {
    throw new Error('--limit must be an integer');
  }
  return args;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PROBE_PAUSE_MS));

interface Candidate {
  id: string;
  slug: string;
  value: string;
}

/**
 * The values the ENGINE would write to a locked `websiteUrl`, which is the population
 * this lane exists for.
 *
 * Asking the engine rather than scanning observations is the fix for two measured
 * defects in the first version of this selection.
 *
 * It was too narrow. 7 of the 16 locked `websiteUrl` instances the engine disagrees
 * about hold a value that reaches the row through `deriveResearchEntityWebsiteUrl`'s
 * citation promotion rather than as a `websiteUrl` observation, so an
 * observation scan cannot see them and the lock stays on after the refusal lands.
 *
 * It was also far too broad. Over every non-archived row that stores no `websiteUrl`,
 * the observation scan selects 378 values across 68 distinct hosts, of which 9 are on
 * a locked row. That is 23x the reachable population in live fetches against Yale and
 * external hosts, to solve a 16-instance problem.
 *
 * `resolveFieldLockReleases` already reports `engineValue` per locked field, whatever
 * path supplies it, so it is both the authoritative answer and the narrow one: 16
 * candidates across 10 hosts.
 */
async function loadLockedRefusalCandidates(slugs: string[], limit?: number): Promise<Candidate[]> {
  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    manuallyLockedFields: 'websiteUrl',
  };
  if (slugs.length > 0) filter.slug = { $in: slugs };
  const rows = await ResearchEntity.find(filter).lean<any[]>();
  const out: Candidate[] = [];
  for (const row of rows) {
    if (String(row.websiteUrl ?? '').trim()) continue;
    const decisions = await resolveFieldLockReleases(row, async (revisedFields) => {
      const answer = await materializeEntity(
        'researchEntity',
        { entityKey: row.slug },
        { dryRun: true, reviseRevisitableFieldLocks: revisedFields },
      );
      if (answer.entityId !== String(row._id)) return undefined;
      if (!answer.plannedSet && !answer.plannedUnset) return undefined;
      return { plannedSet: answer.plannedSet, plannedUnset: answer.plannedUnset };
    });
    for (const decision of decisions) {
      if (decision.field !== 'websiteUrl') continue;
      const value = typeof decision.engineValue === 'string' ? decision.engineValue.trim() : '';
      if (!value) continue;
      const already = liveFieldValueRefusals(row.fieldValueRefusals, 'websiteUrl').some(
        (refusal) => refusal.valueKey === fieldValueRefusalKey('websiteUrl', value),
      );
      if (already) continue;
      out.push({ id: String(row._id), slug: row.slug, value });
    }
    if (limit !== undefined && out.length >= limit) break;
  }
  return limit === undefined ? out : out.slice(0, limit);
}

/**
 * Every row that stores no `websiteUrl` while an observation asserts one, locked or
 * not. Kept behind `--all-cleared-rows` because it is the 378-probe sweep above, and a
 * selection that decides how many live hosts get fetched must be chosen out loud.
 */
async function loadAllClearedRowCandidates(slugs: string[], limit?: number): Promise<Candidate[]> {
  const filter: Record<string, unknown> = { archived: { $ne: true } };
  if (slugs.length > 0) filter.slug = { $in: slugs };
  const rows = await ResearchEntity.find(filter)
    .select('_id slug websiteUrl fieldValueRefusals manuallyLockedFields')
    .lean<any[]>();
  const out: Candidate[] = [];
  for (const row of rows) {
    if (String(row.websiteUrl ?? '').trim()) continue;
    const live = await (Observation as any)
      .find({
        entityType: 'researchEntity',
        entityKey: row.slug,
        field: 'websiteUrl',
        superseded: { $ne: true },
      })
      .select('value')
      .lean();
    for (const observation of live) {
      const value = String(observation.value ?? '').trim();
      if (!value) continue;
      const already = liveFieldValueRefusals(row.fieldValueRefusals, 'websiteUrl').some(
        (refusal) => refusal.valueKey === fieldValueRefusalKey('websiteUrl', value),
      );
      if (already) continue;
      out.push({ id: String(row._id), slug: row.slug, value });
    }
    if (limit !== undefined && out.length >= limit) break;
  }
  return limit === undefined ? out : out.slice(0, limit);
}

async function loadRevivalCandidates(slugs: string[]): Promise<Candidate[]> {
  const filter: Record<string, unknown> = {
    [`fieldValueRefusals.websiteUrl.rule`]: DEAD_WEBSITE_VALUE_REFUSAL_RULE,
  };
  if (slugs.length > 0) filter.slug = { $in: slugs };
  const rows = await ResearchEntity.find(filter)
    .select('_id slug fieldValueRefusals')
    .lean<any[]>();
  const out: Candidate[] = [];
  for (const row of rows) {
    for (const refusal of liveFieldValueRefusals(row.fieldValueRefusals, 'websiteUrl')) {
      if (refusal.rule !== DEAD_WEBSITE_VALUE_REFUSAL_RULE) continue;
      // The evidence URL is what was probed; the key alone is normalized and not
      // fetchable, so a record without one cannot be re-probed and is reported.
      if (!refusal.evidenceUrl) continue;
      out.push({ id: String(row._id), slug: row.slug, value: refusal.evidenceUrl });
    }
  }
  return out;
}

export async function runRefuseDeadWebsiteValues(args: RefuseDeadWebsiteValuesArgs) {
  const candidates = args.revive
    ? await loadRevivalCandidates(args.slugs)
    : args.allClearedRows
      ? await loadAllClearedRowCandidates(args.slugs, args.limit)
      : await loadLockedRefusalCandidates(args.slugs, args.limit);
  const decisions: Array<Record<string, unknown>> = [];
  let written = 0;

  for (const candidate of candidates) {
    const probe = await probeSourceLink(candidate.value);
    const host = (() => {
      try {
        return new URL(candidate.value).host;
      } catch {
        return '(unparseable)';
      }
    })();

    if (args.revive) {
      const verdict = revivedValueWithdrawal(probe);
      decisions.push({ host, mode: 'revive', ...verdict });
      if (verdict.revived && args.apply) {
        const row = await ResearchEntity.findById(candidate.id).lean<any>();
        await ResearchEntity.updateOne(
          { _id: candidate.id },
          {
            $set: planFieldValueRefusalWithdrawal(
              row?.fieldValueRefusals,
              'websiteUrl',
              candidate.value,
              `the page answered HTTP ${verdict.httpStatusCode} on re-probe, so it is admissible again`,
            ),
          },
        );
        written += 1;
      }
    } else {
      const verdict = deadValueRefusalVerdict(probe);
      decisions.push({
        host,
        mode: 'refuse',
        status: probe.status ?? null,
        errorCode: probe.errorCode ?? null,
        ...verdict,
      });
      if (verdict.eligible && args.apply) {
        const row = await ResearchEntity.findById(candidate.id).lean<any>();
        await ResearchEntity.updateOne(
          { _id: candidate.id },
          {
            $set: planFieldValueRefusal(row?.fieldValueRefusals, {
              field: 'websiteUrl',
              value: candidate.value,
              rule: DEAD_WEBSITE_VALUE_REFUSAL_RULE,
              refusedBy: SCRIPT_NAME,
              note: deadValueRefusalNote({
                httpStatusCode: verdict.httpStatusCode,
                probedAt: new Date(),
              }),
              evidenceUrl: candidate.value,
            }),
          },
        );
        written += 1;
      }
    }
    await pause();
  }

  const eligible = decisions.filter((d) => d.eligible === true || d.revived === true).length;
  return {
    mode: args.revive
      ? 'revive'
      : args.allClearedRows
        ? 'refuse-all-cleared-rows'
        : 'refuse-locked',
    applied: args.apply,
    candidates: candidates.length,
    eligible,
    inconclusive: decisions.length - eligible,
    written,
    decisions,
  };
}

async function main(): Promise<void> {
  const args = parseRefuseDeadWebsiteValuesArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await runRefuseDeadWebsiteValues(args);
    const { decisions, ...summary } = result;
    for (const decision of decisions) console.log(JSON.stringify(decision));
    console.log(JSON.stringify(summary, null, 2));
    if (args.output) {
      fs.mkdirSync(path.dirname(args.output), { recursive: true });
      fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
