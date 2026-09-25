import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { planResearchEntityNameChanges } from './backfillResearchEntityNames';
import {
  comparePlannedFieldToProjection,
  summarizePlanAudit,
  verdictForScript,
  type PlanAuditRow,
  type PlannedFieldChange,
} from './auditPlansTheProjectionDeclinesCore';
import { planLinkChromeNameRepair } from './repairLinkChromeEntityNamesCore';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MAX_ROWS_PER_SCRIPT = 40;

/**
 * A repair the audit can evaluate has an exported planner it can call without a network
 * fetch. Anything else is an `unknown` with its reason, because a script the audit cannot
 * dry-run is not a pass.
 */
interface AuditableScript {
  script: string;
  plan?: () => Promise<PlannedFieldChange[]>;
  unknownReason?: string;
}

const liveRows = () =>
  ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug name displayName entityType kind manuallyLockedFields websiteUrl sourceUrls')
    .lean();

async function planFromResearchEntityNames(): Promise<PlannedFieldChange[]> {
  const rows = (await liveRows()) as Array<Record<string, unknown>>;
  const changes: PlannedFieldChange[] = [];
  for (const row of rows) {
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      entityKey: String(row.slug ?? ''),
      field: { $in: ['name', 'displayName'] },
      superseded: { $ne: true },
    })
      .select('field value confidence sourceName observedAt')
      .lean()) as never[];
    for (const change of planResearchEntityNameChanges(row as never, observations)) {
      changes.push({ entityKey: change.slug, field: change.field, plannedValue: change.to });
    }
    if (changes.length >= MAX_ROWS_PER_SCRIPT) break;
  }
  return changes;
}

/**
 * The control for `reproduces`, and a real script rather than a fixture.
 *
 * `repairLinkChromeEntityNames` strips link chrome from a name using the same
 * `stripResearchHomeNameLinkChrome` the projection applies, so the projection should reach
 * the same value. It is also the script `repairUnbackedLabNames` is meant to follow.
 */
async function planFromLinkChromeNames(): Promise<PlannedFieldChange[]> {
  const rows = (await liveRows()) as Array<Record<string, unknown>>;
  const changes: PlannedFieldChange[] = [];
  for (const row of planLinkChromeNameRepair(rows as never)) {
    if (row.outcome !== 'strip' || !row.repairedName) continue;
    changes.push({ entityKey: row.slug, field: 'name', plannedValue: row.repairedName });
    if (row.repairedDisplayName) {
      changes.push({
        entityKey: row.slug,
        field: 'displayName',
        plannedValue: row.repairedDisplayName,
      });
    }
    if (changes.length >= MAX_ROWS_PER_SCRIPT) break;
  }
  return changes;
}

const SCRIPTS: AuditableScript[] = [
  { script: 'research-homes:backfill-names', plan: planFromResearchEntityNames },
  { script: 'research-entity:repair-link-chrome-names', plan: planFromLinkChromeNames },
  {
    script: 'research-homes:repair-unbacked-lab-names',
    unknownReason:
      'its lead-name input is loaded by a private function the audit cannot reuse, and an empty map would report a verdict about the input rather than the script',
  },
  {
    script: 'observations:retire-affiliated-org-name-grafts',
    unknownReason: 'no exported pure planner: rows are built inside an async database read',
  },
  {
    script: 'observations:retarget-foreign-lab-websites',
    unknownReason: 'no exported pure planner, and the apply path probes pages over the network',
  },
  {
    script: 'research-entity:lab-branded-name-type-backfill',
    unknownReason:
      'planner needs harvested brand candidates the audit cannot reconstruct read-only',
  },
  {
    script: 'research-homes:retype-from-declared-page-type',
    unknownReason: 'planner input comes from a page-type probe, which is a network read',
  },
];

/**
 * Proves the `reproduces` arm fires on live data.
 *
 * Neither currently-callable harmless repair has a non-empty plan on today's corpus, so no
 * real script yields `reproduces` and the arm would otherwise go unexercised. This takes the
 * projection's OWN planned value for a real row and feeds it back, which must report
 * reproduced. It is a control on the instrument, not a script, and it is reported as such.
 */
async function reproducesArmControl(): Promise<PlanAuditRow> {
  const rows = (await liveRows()) as Array<Record<string, unknown>>;
  let reproduced = 0;
  let declined = 0;
  for (const row of rows) {
    const key = String(row.slug ?? '');
    if (!key) continue;
    const projection = await materializeEntity(
      'researchEntity',
      { entityKey: key },
      { dryRun: true },
    );
    const planned = projection.plannedSet ?? {};
    const field = Object.keys(planned).find((candidate) => candidate === 'name');
    if (!field) continue;
    const verdict = comparePlannedFieldToProjection(
      { entityKey: key, field, plannedValue: planned[field] },
      planned,
    );
    if (verdict.reproduced) reproduced += 1;
    else declined += 1;
    if (reproduced + declined >= 5) break;
  }
  return {
    script: '(control) the projection agreeing with itself',
    verdict: verdictForScript({ planned: reproduced + declined, declined }),
    planned: reproduced + declined,
    declined,
    reproduced,
  };
}

export async function runPlanDeclineAudit(): Promise<{
  scriptsExamined: number;
  summary: Record<string, number>;
  rows: PlanAuditRow[];
  armControl: PlanAuditRow;
}> {
  const rows: PlanAuditRow[] = [];
  for (const entry of SCRIPTS) {
    if (!entry.plan) {
      rows.push({
        script: entry.script,
        verdict: 'unknown',
        planned: 0,
        declined: 0,
        reproduced: 0,
        unknownReason: entry.unknownReason,
      });
      continue;
    }
    const planned = await entry.plan();
    let declined = 0;
    let reproduced = 0;
    const examples: PlanAuditRow['examples'] = [];
    for (const change of planned) {
      // Dry run: reads the projection's own plan and writes nothing.
      const projection = await materializeEntity(
        'researchEntity',
        { entityKey: change.entityKey },
        { dryRun: true },
      );
      const verdict = comparePlannedFieldToProjection(change, projection.plannedSet);
      if (verdict.reproduced) reproduced += 1;
      else {
        declined += 1;
        if (examples.length < 3 && verdict.reason) {
          examples.push({ field: change.field, reason: verdict.reason });
        }
      }
    }
    rows.push({
      script: entry.script,
      verdict: verdictForScript({ planned: planned.length, declined }),
      planned: planned.length,
      declined,
      reproduced,
      ...(examples.length > 0 ? { examples } : {}),
    });
  }
  const control = await reproducesArmControl();
  return {
    scriptsExamined: SCRIPTS.length,
    summary: summarizePlanAudit(rows),
    rows,
    armControl: control,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) {
    throw new Error('This is an instrument. It has no apply path and writes nothing.');
  }
  await initializeConnections();
  try {
    const report = await runPlanDeclineAudit();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
