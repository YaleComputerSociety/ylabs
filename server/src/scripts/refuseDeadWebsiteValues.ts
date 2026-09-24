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
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:refuse-dead-website-values';
const PROBE_PAUSE_MS = 2500;

export interface RefuseDeadWebsiteValuesArgs {
  slugs: string[];
  revive: boolean;
  apply: boolean;
  confirm: boolean;
  limit?: number;
  output?: string;
}

export function parseRefuseDeadWebsiteValuesArgs(argv: string[]): RefuseDeadWebsiteValuesArgs {
  const args: RefuseDeadWebsiteValuesArgs = {
    slugs: [],
    revive: false,
    apply: false,
    confirm: false,
  };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-dead-website-value-refusal') args.confirm = true;
    else if (arg === '--revive') args.revive = true;
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
 * Rows whose `websiteUrl` the corpus still asserts while the row stores nothing. That
 * is the population a dead value can be frozen on: if the row served the value there
 * would be no clear to keep, and if no observation asserted it there would be nothing
 * to refuse.
 */
async function loadRefusalCandidates(slugs: string[], limit?: number): Promise<Candidate[]> {
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
    : await loadRefusalCandidates(args.slugs, args.limit);
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
    mode: args.revive ? 'revive' : 'refuse',
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
