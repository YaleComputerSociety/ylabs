/**
 * research-entity:refuse-unasserted-descriptions - refuses a stored description whose
 * own lane, on re-reading the page it cites, positively attested that the page carries
 * no research prose.
 *
 * `refuseUnassertedDescriptionsCore` owns the verdict and its three guards. This runner
 * owns reading the observation log, the writes, and the verification.
 *
 * The evidence is `assertsNoValueFor: ['fullDescription', 'shortDescription']` on an
 * observation from `lab-microsite-description-llm`, which the lane sets only on its
 * `empty` slot attestation: the page was fetched whole, was long enough to judge, the
 * extraction ran, and the crawl completed. A fetch failure, a JS shell, or a guard
 * keeping the stored value on purpose leaves the claim unmade, which is the whole
 * reason this reads an assertion rather than a silence (#2647).
 *
 * Producing that evidence is a separate operation, because it costs a paid re-read:
 *
 *   yarn --cwd server scrape run --source lab-microsite-description-llm \
 *     --only <slugs> --limit 500 --force-llm --ignore-work-planner
 *
 * Run it twice, on different days, because an LLM lane is not repeatable and
 * `MIN_ATTESTED_EMPTY_READS` wants two distinct runs.
 *
 * Stored fields are set before the rematerialize, the ordering #3314 and #3322
 * established: once a value is refused the stored value is what the derivation reads,
 * so setting it afterwards would let one pass serve a row whose every candidate had
 * just been refused. Each row is rematerialized twice and re-read through the detail
 * route, because a correction that holds for one pass, or that needs a lock to hold, is
 * the frozen-field defect under another name. A row whose description this clears goes
 * back through the visibility gate, because `source_backed_description` was awarded on
 * the copy that just went away.
 *
 * Usage:
 *   yarn --cwd server research-entity:refuse-unasserted-descriptions
 *   yarn --cwd server research-entity:refuse-unasserted-descriptions --apply \
 *     --confirm-unasserted-description-refusal
 *   yarn --cwd server research-entity:refuse-unasserted-descriptions --slug=<slug> \
 *     --output /tmp/report.json
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
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  DESCRIPTION_ATTESTING_SOURCE_NAME,
  UNASSERTED_DESCRIPTION_FIELDS,
  UNASSERTED_DESCRIPTION_REFUSAL_RULE,
  planUnassertedDescriptionRefusals,
  type AttestedEmptyRead,
  type DescriptionRefusalRow,
} from './refuseUnassertedDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:refuse-unasserted-descriptions';
const CONFIRM_FLAG = '--confirm-unasserted-description-refusal';
const REFUSED_BY = SCRIPT_NAME;

interface Options {
  apply: boolean;
  confirm: boolean;
  slugs: string[];
  output?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, confirm: false, slugs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === CONFIRM_FLAG) options.confirm = true;
    else if (arg.startsWith('--slug=')) options.slugs.push(arg.slice('--slug='.length));
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    else if (arg === '--output') options.output = argv[index + 1];
  }
  if (options.apply && !options.confirm) {
    throw new Error(`${CONFIRM_FLAG} is required when --apply is set for ${SCRIPT_NAME}.`);
  }
  return options;
}

async function loadAttestedEmptyReads(slugs: string[]): Promise<AttestedEmptyRead[]> {
  const query: Record<string, unknown> = {
    sourceName: DESCRIPTION_ATTESTING_SOURCE_NAME,
    assertsNoValueFor: { $all: [...UNASSERTED_DESCRIPTION_FIELDS] },
  };
  if (slugs.length > 0) query.entityKey = { $in: slugs };
  const rows = await Observation.find(query)
    .select('entityKey sourceUrl scrapeRunId')
    .lean<Array<{ entityKey?: string; sourceUrl?: string; scrapeRunId?: unknown }>>();
  return rows
    .filter((row) => row.entityKey && row.sourceUrl)
    .map((row) => ({
      entityKey: String(row.entityKey),
      sourceUrl: String(row.sourceUrl),
      runId: String(row.scrapeRunId ?? ''),
    }));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const reads = await loadAttestedEmptyReads(options.slugs);
  const attestedSlugs = Array.from(new Set(reads.map((read) => read.entityKey)));
  // The drop-guard denominator is the lane's own read population in the SAME runs that
  // produced the attestations. Scoped any other way it stops measuring whether the
  // extraction broke: over the pass's own targets it is a tautology, and over every run
  // the lane ever made it is diluted by history.
  const runIds = Array.from(new Set(reads.map((read) => read.runId).filter(Boolean)));
  const rowQuery: Record<string, unknown> = { archived: { $ne: true } };
  rowQuery.slug = { $in: options.slugs.length > 0 ? options.slugs : attestedSlugs };
  const rows = (await ResearchEntity.find(rowQuery)
    .select('slug fullDescription shortDescription fieldProvenance fieldValueRefusals manuallyLockedFields')
    .lean()) as unknown as DescriptionRefusalRow[];

  const laneReadEntityCount = (
    await Observation.distinct('entityKey', {
      sourceName: DESCRIPTION_ATTESTING_SOURCE_NAME,
      ...(runIds.length > 0 ? { scrapeRunId: { $in: runIds } } : {}),
    })
  ).length;
  const plan = planUnassertedDescriptionRefusals({ rows, reads, laneReadEntityCount });
  const report: Record<string, unknown> = {
    mode: options.apply ? 'apply' : 'dry-run',
    attestedEmptyObservations: reads.length,
    attestedEmptyEntities: attestedSlugs.length,
    examinedRowCount: plan.examinedRowCount,
    attestedEmptyEntityCount: plan.attestedEmptyEntityCount,
    laneReadEntityCount: plan.laneReadEntityCount,
    attestedEmptyFraction: Number(plan.attestedEmptyFraction.toFixed(4)),
    dropGuard: plan.dropGuard,
    frozen: plan.frozen,
    ...(plan.frozenReason ? { frozenReason: plan.frozenReason } : {}),
    planned: plan.plans.length,
    skipCounts: plan.skips.reduce<Record<string, number>>((counts, skip) => {
      counts[skip.reason] = (counts[skip.reason] ?? 0) + 1;
      return counts;
    }, {}),
    refused: 0,
    servedAfter: [] as Array<Record<string, unknown>>,
  };

  if (options.apply && !plan.frozen) {
    const bySlug = new Map<string, typeof plan.plans>();
    for (const entry of plan.plans) {
      bySlug.set(entry.slug, [...(bySlug.get(entry.slug) ?? []), entry]);
    }
    for (const [slug, entries] of bySlug) {
      const row = await ResearchEntity.findOne({ slug }).lean();
      if (!row) continue;
      const update: Record<string, unknown> = {};
      // Per-field by construction: `planFieldValueRefusal` returns a `$set` fragment keyed
      // on `fieldValueRefusals.<field>`, so two fields on one row never share a list and
      // nothing has to accumulate between them.
      const refusals: unknown = (row as Record<string, unknown>).fieldValueRefusals;
      for (const entry of entries) {
        const fragment = planFieldValueRefusal(refusals, {
          field: entry.field,
          value: entry.value,
          rule: UNASSERTED_DESCRIPTION_REFUSAL_RULE,
          refusedBy: REFUSED_BY,
          note: `The lane attested on ${entry.attestedReadCount} complete reads that this page carries no research prose to assert.`,
          evidenceUrl: entry.evidenceUrl,
        });
        Object.assign(update, fragment);
        update[entry.field] = '';
      }
      const recordId = String((row as Record<string, unknown>)._id);
      await ResearchEntity.updateOne({ slug }, { $set: update });
      report.refused = (report.refused as number) + entries.length;
      await materializeEntity('researchEntity', { entityId: recordId });
      await materializeEntity('researchEntity', { entityId: recordId });
      const gatePlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [recordId],
      });
      await applyStudentVisibilityGatePlans(gatePlans);
      const detail = await getResearchGroupDetail(slug);
      (report.servedAfter as Array<Record<string, unknown>>).push({
        slug,
        servedByDetailRoute: Boolean(detail),
        servedFullDescription: detail
          ? String(
              (detail as { researchEntity?: Record<string, unknown> }).researchEntity
                ?.fullDescription ?? '',
            ).slice(0, 120)
          : null,
      });
    }
  }

  const serialized = JSON.stringify({ ...report, plans: plan.plans, skips: plan.skips }, null, 2);
  if (options.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(options.output), serialized);
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
  process.exitCode = 1;
});
