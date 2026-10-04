import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  comparePlannedFieldToProjection,
  summarizePlanAudit,
  verdictForScript,
  type PlanAuditRow,
  type PlannedFieldChange,
} from './auditPlansTheProjectionDeclinesCore';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  quiet: true,
});

const MAX_ROWS_PER_SCRIPT = 40;

/**
 * A repair the audit can evaluate has an exported planner it can call without a network
 * fetch. Anything else is an `unknown` with its reason, because a script the audit cannot
 * dry-run is not a pass.
 */
export interface AuditableScript {
  script: string;
  plan?: () => Promise<PlannedFieldChange[]>;
  unknownReason?: string;
}

const liveRows = () =>
  ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug name displayName entityType kind manuallyLockedFields websiteUrl sourceUrls')
    .lean();

/**
 * Two absences, for two different reasons, and the state they leave.
 *
 * `research-homes:backfill-names` went first: the audit reported it declining 41 of 41
 * sampled changes and it was deleted for that reason, so it is no longer a script the audit
 * can examine.
 *
 * `research-entity:repair-link-chrome-names` went second, and not because it was wrong. Its
 * correction is applied at ingest - `observationFieldSanitizer` composes
 * `stripResearchHomeNameLinkChrome` - and its planner found chrome on 0 of 4,601 live rows,
 * so the entry contributed no examined change while making this instrument depend on a
 * repair script to exist (#3691).
 *
 * So every entry below is now `unknown`, and that is the honest reading rather than a gap:
 * with no repair both callable read-only and decidable without a write, this file is a
 * registry of WHY each remaining repair cannot be dry-run, plus the live control below. Both
 * arms of `comparePlannedFieldToProjection` keep their proof in the mutation-checked unit
 * tests, which is the correct steady state once no repair is wrong. An entry gaining a
 * `plan` again is the signal that a repair has become auditable, not that this file regressed.
 */
export const AUDITED_REPAIR_SCRIPTS: AuditableScript[] = [
  {
    // Auditable now that `loadLeadNamesBySlug` is exported (#3398), but still not DECIDABLE
    // read-only. It appends its corrected name as an observation before writing the field, so
    // the projection's answer today is "I have no such assertion" and the audit reports
    // `declines` on a value the script itself makes backed a moment later. Running the audit
    // over my own conversion is what surfaced this: the instrument answers "would the
    // projection accept this AS THINGS STAND", which is the wrong question for a lane that
    // asserts first, and reporting it as declining would be indistinguishable from a real
    // pre-authority defect. Deciding it needs the append to have happened, which an
    // instrument that writes nothing cannot arrange.
    script: 'research-entity:repair-unbacked-lab-names',
    unknownReason:
      'asserts its own evidence before writing, so the projection-today comparison does not decide it; deciding it requires the append, which a read-only instrument cannot perform',
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
    script: 'research-entity:backfill-lab-branded-name-type',
    unknownReason:
      'planner needs harvested brand candidates the audit cannot reconstruct read-only',
  },
  {
    script: 'research-entity:retype-from-declared-page-type',
    unknownReason: 'planner input comes from a page-type probe, which is a network read',
  },
];

/**
 * What the run can establish live, which is narrower than it used to claim.
 *
 * The previous control took the projection's OWN planned `name` for a row and fed it back
 * to `comparePlannedFieldToProjection`, then reported that it reproduced. That is
 * `JSON.stringify(x) === JSON.stringify(x)`: it exercises no branch the comparator's unit
 * tests do not already cover, and labelling it a proof made the run read as having live
 * coverage it did not have. Both comparator arms are proven where they belong, in
 * `auditPlansTheProjectionDeclinesCore.test.ts`, which covers a field absent from the
 * planned set, a field planned differently, a field planned identically including a list,
 * and a planned null (#3691).
 *
 * It also depended on a repair script's planner to supply the live `reproduces` case, so
 * the instrument could not outlive the scripts it audits. It now depends on none.
 *
 * What is worth checking live is a different question, and it is about this instrument
 * rather than about the comparator: does the projection answer at all? Every verdict here
 * is read off `plannedSet`, so if the projection planned no `name` for any row, each
 * audited change would report `not-in-planned-set` and the run would read as "every repair
 * is wrong" when the truth is that the instrument is blind. This counts the live rows the
 * projection does plan a `name` for, so a zero is visible as an instrument failure instead
 * of being distributed across the scripts as verdicts.
 */
async function projectionAnswersControl(): Promise<PlanAuditRow> {
  const rows = (await liveRows()) as Array<Record<string, unknown>>;
  let plansAName = 0;
  let plansNoName = 0;
  for (const row of rows) {
    const key = String(row.slug ?? '');
    if (!key) continue;
    const projection = await materializeEntity(
      'researchEntity',
      { entityKey: key },
      { dryRun: true },
    );
    const planned = projection.plannedSet ?? {};
    if (Object.prototype.hasOwnProperty.call(planned, 'name')) plansAName += 1;
    else plansNoName += 1;
    if (plansAName + plansNoName >= MAX_ROWS_PER_SCRIPT) break;
  }
  return {
    script: '(control) the projection plans a name for a live row',
    // `declines` when the projection planned a name for none of the sampled rows, because
    // then no verdict in this run is about a script.
    verdict: plansAName > 0 ? 'reproduces' : 'declines',
    planned: plansAName + plansNoName,
    declined: plansNoName,
    reproduced: plansAName,
  };
}

export async function runPlanDeclineAudit(): Promise<{
  scriptsExamined: number;
  summary: Record<string, number>;
  rows: PlanAuditRow[];
  armControl: PlanAuditRow;
}> {
  const rows: PlanAuditRow[] = [];
  for (const entry of AUDITED_REPAIR_SCRIPTS) {
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
  const control = await projectionAnswersControl();
  return {
    scriptsExamined: AUDITED_REPAIR_SCRIPTS.length,
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
