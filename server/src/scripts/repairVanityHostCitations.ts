/**
 * sources:repair-vanity-host-citations - repoints a citation on a vanity redirect
 * host at the canonical page it already redirects to (#2758).
 *
 * #2751 stopped a certificate name mismatch retiring these citations, so a student
 * can now reach them and gets a browser TLS warning instead of the page. The host
 * exists only to redirect; the page it names is live over https.
 *
 * Dry-run by default. Every rule fails closed: the citation must fail on a
 * certificate name mismatch, plain HTTP must reach a different host over https
 * within the hop cap, and that destination must probe decisively HEALTHY through
 * `classifySourceLinkHealth` rather than a raw status range.
 *
 *   yarn --cwd server sources:repair-vanity-host-citations
 *   yarn --cwd server sources:repair-vanity-host-citations --apply --confirm-vanity-citation-repair --limit=25
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { checkSourceLinkHealth, probeSourceLink } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  MAX_VANITY_REDIRECT_HOPS,
  decideVanityRepair,
  planVanityRepairRow,
} from './repairVanityHostCitationsCore';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';

export interface VanityRepairOptions {
  apply: boolean;
  confirm: boolean;
  limit?: number;
  output?: string;
}

export function parseVanityRepairArgs(argv: string[]): VanityRepairOptions {
  const options: VanityRepairOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-vanity-citation-repair') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error('--limit must be a positive integer');
      options.limit = Number(raw);
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-vanity-citation-repair.');
  }
  return options;
}

/** Follows plain-HTTP redirects by hand so the hop count is visible to the caller. */
async function followHttpRedirects(
  httpsUrl: string,
): Promise<{ destinationUrl?: string; hops: number }> {
  let current = httpsUrl.replace(/^https:/i, 'http:');
  for (let hops = 1; hops <= MAX_VANITY_REDIRECT_HOPS; hops += 1) {
    let res: Response;
    try {
      res = await fetch(current, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      return { hops };
    }
    const location = res.headers.get('location');
    if (!location) return { destinationUrl: current, hops };
    try {
      current = new URL(location, current).toString();
    } catch {
      return { hops };
    }
    if (res.status < 300 || res.status >= 400) return { destinationUrl: current, hops };
  }
  return { hops: MAX_VANITY_REDIRECT_HOPS + 1 };
}

async function main() {
  const options = parseVanityRepairArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repairVanityHostCitations',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  // A cert mismatch stores UNKNOWN with no httpStatusCode after #2751, which is a
  // cheap pre-filter; the probe below is what actually decides.
  const rows = (await ResearchEntity.find({
    sourceLinkHealth: {
      $elemMatch: { healthStatus: 'UNKNOWN', httpStatusCode: { $exists: false } },
    },
  })
    .select(
      'slug sourceUrls websiteUrl website manuallyLockedFields fieldValueRefusals sourceLinkHealth archived studentVisibilityTier',
    )
    .lean()) as unknown as Array<Record<string, any>>;

  const decisionCache = new Map<
    string,
    { repoint: boolean; destinationUrl?: string; refusal?: string }
  >();
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    rowsScanned: rows.length,
    citationsProbed: 0,
    repointed: [] as Array<Record<string, unknown>>,
    refused: [] as Array<Record<string, unknown>>,
    errors: 0,
  };

  for (const row of rows) {
    if (options.limit && report.repointed.length >= options.limit) break;
    const candidates = new Set<string>(
      (row.sourceLinkHealth ?? [])
        .filter((h: any) => h?.healthStatus === 'UNKNOWN' && h?.httpStatusCode == null)
        .map((h: any) => h?.url)
        .filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//i.test(u)),
    );

    for (const vanityUrl of candidates) {
      try {
        let decision = decisionCache.get(vanityUrl);
        if (!decision) {
          report.citationsProbed += 1;
          const probe = await probeSourceLink(vanityUrl);
          let destinationUrl: string | undefined;
          let hops = 0;
          let destinationHealth: string | undefined;
          if (probe.errorCode === 'ERR_TLS_CERT_ALTNAME_INVALID') {
            const followed = await followHttpRedirects(vanityUrl);
            destinationUrl = followed.destinationUrl;
            hops = followed.hops;
            if (destinationUrl) {
              destinationHealth = (await checkSourceLinkHealth(destinationUrl)).healthStatus;
            }
          }
          decision = decideVanityRepair(vanityUrl, {
            citationErrorCode: probe.errorCode,
            destinationUrl,
            hops,
            destinationHealth,
          });
          decisionCache.set(vanityUrl, decision);
        }

        if (!decision.repoint || !decision.destinationUrl) {
          if (decision.refusal !== 'not-cert-mismatch') {
            report.refused.push({ slug: row.slug, url: vanityUrl, refusal: decision.refusal });
          }
          continue;
        }

        const change = planVanityRepairRow(row, vanityUrl, decision.destinationUrl);
        if (!change) continue;

        report.repointed.push({
          slug: row.slug,
          from: vanityUrl,
          to: decision.destinationUrl,
          changedFields: change.changedFields,
          served: !row.archived && row.studentVisibilityTier === 'student_ready',
        });

        if (options.apply) {
          const { changedFields: _changedFields, fieldValueRefusalUpdate, ...fields } = change;
          await ResearchEntity.updateOne(
            { _id: row._id },
            { $set: { ...fields, ...(fieldValueRefusalUpdate ?? {}) } },
          );
        }
      } catch (error) {
        report.errors += 1;
        console.error(
          `vanity-host citation repair failed for ${String(row.slug)}:`,
          sanitizeLogValue(error),
        );
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    const safe = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safe), { recursive: true });
    fs.writeFileSync(safe, `${JSON.stringify(report, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main()
    .catch((error) => {
      console.error('Failed to repair vanity-host citations:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
