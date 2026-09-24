/**
 * research-entity:collapse-citation-mirrors - collapses citations that are one person's
 * page reached by different paths, and re-points everything that named a dropped spelling
 * (#3240, the stored half of #3207).
 *
 * A Yale host publishes a person under several section prefixes, and a department renames
 * a roster-cohort segment while both spellings survive as citations. Counting one page
 * twice overstates how well a row is corroborated and makes a link-health re-probe pay
 * twice for one fetch.
 *
 * Which spelling survives is decided by recorded health before canonicality, because 50
 * groups record one spelling HEALTHY and the other UNAVAILABLE: a department retires the
 * old cohort path when it renames the segment, so the prettier URL is sometimes the dead
 * one.
 *
 * Touches only a URL whose mirror key matches a retained citation. `sourceLinkHealth` and
 * `fieldProvenance` entries pointing at some other URL the row no longer cites are a much
 * larger backlog with a different question behind it, and are reported rather than pruned.
 *
 * Dry run by default; `--apply` writes, re-gates every touched row, and resyncs Meili.
 *
 *   yarn --cwd server research-entity:collapse-citation-mirrors
 *   yarn --cwd server research-entity:collapse-citation-mirrors --apply
 *   yarn --cwd server research-entity:collapse-citation-mirrors --limit=20 --apply
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import {
  applyStudentVisibilityGatePlans,
  evaluateStudentVisibilityGateLeadResolution,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  planCitationMirrorCollapse,
  summarizeCitationMirrorPlans,
  type CitationMirrorPlan,
  type CitationMirrorRow,
} from './collapsePersonPageCitationMirrorsCore';

dotenv.config();

const SCRIPT_NAME = 'research-entity:collapse-citation-mirrors';

const numericFlag = (name: string): number | undefined => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const run = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is not set');
  assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl });

  await mongoose.connect(mongoUrl, { maxPoolSize: 5 });
  const collection = mongoose.connection.db!.collection('research_entities');

  const limit = numericFlag('limit');
  const cursor = collection.find(
    { archived: { $ne: true } },
    {
      projection: {
        slug: 1,
        sourceUrls: 1,
        sourceLinkHealth: 1,
        fieldProvenance: 1,
        studentDecisionExplanation: 1,
      },
    },
  );
  const rows = (await (limit ? cursor.limit(limit) : cursor).toArray()) as CitationMirrorRow[];

  const plans: CitationMirrorPlan[] = [];
  const planRows = new Map<string, CitationMirrorRow>();
  for (const row of rows) {
    const plan = planCitationMirrorCollapse(row);
    if (!plan) continue;
    plans.push(plan);
    planRows.set(plan.slug, row);
  }

  const summary = summarizeCitationMirrorPlans(plans, rows.length);
  console.log(`[${SCRIPT_NAME}] ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(JSON.stringify(summary, null, 1));
  console.log('');
  console.log('collapsed groups by citing host:');
  const byHost = new Map<string, number>();
  plans.forEach((plan) =>
    plan.groups.forEach((group) => byHost.set(group.host, (byHost.get(group.host) || 0) + 1)),
  );
  Array.from(byHost.entries())
    .sort((left, right) => right[1] - left[1])
    .forEach(([host, count]) => console.log(`  ${host}: ${count}`));

  if (!apply) {
    console.log('');
    console.log('Dry run applied no patch. Re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  let patched = 0;
  const touchedIds: string[] = [];
  for (const plan of plans) {
    const row = planRows.get(plan.slug)!;
    const set: Record<string, unknown> = {};
    if (plan.sourceUrls) set.sourceUrls = plan.sourceUrls;
    if (plan.sourceLinkHealth) set.sourceLinkHealth = plan.sourceLinkHealth;
    if (plan.decisionSourceUrls) {
      set['studentDecisionExplanation.sourceUrls'] = plan.decisionSourceUrls;
    }
    plan.fieldProvenanceRepoints.forEach((repoint) => {
      set[`fieldProvenance.${repoint.field}.sourceUrl`] = repoint.toUrl;
    });
    if (Object.keys(set).length === 0) continue;
    const result = await collection.updateOne({ _id: row._id as never }, { $set: set });
    if (result.modifiedCount > 0) {
      patched += 1;
      const id = serializedDocumentId(row._id);
      if (id) touchedIds.push(id);
    }
  }

  console.log('');
  console.log(`patched: ${patched}`);

  /**
   * `sourceUrls` is a gate input: `source_backed_description` claims a source backs the
   * description. Collapsing a mirror never empties the list, so the verdict should not
   * move, but a repair that rewrites documents and never re-derives what the gate
   * concluded from them is how a row ends up stored `student_ready` while its detail page
   * disagrees. The gate's own lead-resolution guard runs first, because
   * `applyStudentVisibilityGatePlans` is the raw writer.
   */
  let regated = 0;
  if (touchedIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    const leadResolution = evaluateStudentVisibilityGateLeadResolution(gatePlans);
    if (leadResolution.safe) {
      await applyStudentVisibilityGatePlans(gatePlans);
      regated = gatePlans.length;
    } else {
      console.error(`[${SCRIPT_NAME}] Skipping re-gate: ${leadResolution.blocker}`);
    }

    const objectIds = touchedIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length > 0) {
      const docs = await ResearchEntity.find({ _id: { $in: objectIds } }).lean();
      try {
        await syncEntities('researchEntity', docs as unknown[]);
      } catch (error) {
        console.error(`[${SCRIPT_NAME}] Meili resync failed:`, sanitizeLogValue(error));
      }
    }
  }
  console.log(`re-gated: ${regated}`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
