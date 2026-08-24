/**
 * Data repair for the #1557 reopened fullDescription residual: every Yale
 * residential-college Mellon Senior Research Grant and Richter Summer
 * Fellowship entity carries a fullDescription that is, modulo minor wording
 * drift, the same shared administrative funding-mechanics boilerplate across
 * colleges - the IRS-taxable-income note, the $1,500 award cap, the academic-
 * year timing - never naming the entity's own college or stating that
 * eligibility is gated to that college's own students. #1597 already fixed
 * the analogous shortDescription defect (Closes #1557, since reopened for
 * this fullDescription-scoped residual); this backfill applies the same
 * per-college synthesis to fullDescription.
 *
 * Derives each entity's own residential college from its displayName (same
 * derivation used for the shortDescription fix) and writes a distinguishing
 * fullDescription naming that college and stating the eligibility gate. The
 * applied field is locked via manuallyLockedFields so a future scraper/
 * backfill pass cannot silently revert it to the shared template.
 *
 * Dry-run by default.
 *   yarn --cwd server tsx src/scripts/backfillResidentialCollegeGrantFullDescriptions.ts
 *   yarn --cwd server tsx src/scripts/backfillResidentialCollegeGrantFullDescriptions.ts \
 *     --apply --confirm-residential-college-grant-full-description-backfill
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildResidentialCollegeGrantFullDescription,
  buildRichterFellowshipFullDescription,
  deriveResidentialCollegeName,
  deriveRichterFellowshipCollegeName,
  isResidentialCollegeGrantBoilerplateFullDescription,
  isRichterFellowshipFamilyDisplayName,
} from './backfillResidentialCollegeGrantFullDescriptionsCore';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-residential-college-grant-full-description-backfill') {
      options.confirm = true;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(
      '--confirm-residential-college-grant-full-description-backfill is required when --apply is set.',
    );
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillResidentialCollegeGrantFullDescriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const mellonCandidates: any[] = await ResearchEntity.find({
    fullDescription: { $regex: /off-?set the costs associated with a senior research project/i },
  })
    .select('_id entityType displayName fullDescription manuallyLockedFields')
    .lean();

  const richterCandidates: any[] = await ResearchEntity.find({
    displayName: { $regex: /Richter/i },
    entityType: 'FELLOWSHIP_PROGRAM',
  })
    .select('_id entityType displayName fullDescription manuallyLockedFields')
    .lean();

  const plannedUpdates: Array<{ recordId: string; entityType: string; set: Record<string, unknown> }> =
    [];
  const report: Array<Record<string, unknown>> = [];

  const planned = new Set<string>();

  const plan = (
    entity: any,
    matches: boolean,
    unresolvedStatus: string,
    collegeName: string,
    fullDescription: string,
  ): void => {
    const recordId = String(entity._id);
    if (planned.has(recordId)) return;
    if (!matches) {
      report.push({ recordId, displayName: entity.displayName, status: unresolvedStatus });
      return;
    }
    if (!collegeName) {
      report.push({ recordId, displayName: entity.displayName, status: 'unresolved_college_name' });
      return;
    }
    if (fullDescription === entity.fullDescription) {
      report.push({ recordId, displayName: entity.displayName, status: 'noop' });
      return;
    }
    const lockedFields = Array.from(
      new Set([...(Array.isArray(entity.manuallyLockedFields) ? entity.manuallyLockedFields : []), 'fullDescription']),
    );
    planned.add(recordId);
    plannedUpdates.push({
      recordId,
      entityType: entity.entityType,
      set: { fullDescription, manuallyLockedFields: lockedFields },
    });
    report.push({
      recordId,
      displayName: entity.displayName,
      status: 'planned',
      collegeName,
      from: entity.fullDescription,
      to: fullDescription,
    });
  };

  for (const entity of mellonCandidates) {
    const matches = isResidentialCollegeGrantBoilerplateFullDescription(entity.fullDescription);
    const collegeName = matches ? deriveResidentialCollegeName(entity.displayName) : '';
    const fullDescription = collegeName
      ? buildResidentialCollegeGrantFullDescription(collegeName)
      : '';
    plan(entity, matches, 'not_boilerplate', collegeName, fullDescription);
  }

  for (const entity of richterCandidates) {
    const matches = isRichterFellowshipFamilyDisplayName(entity.displayName);
    const collegeName = matches ? deriveRichterFellowshipCollegeName(entity.displayName) : '';
    const fullDescription = collegeName ? buildRichterFellowshipFullDescription(collegeName) : '';
    plan(entity, matches, 'not_richter_family', collegeName, fullDescription);
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scannedMellon: mellonCandidates.length,
    scannedRichter: richterCandidates.length,
    plannedUpdates: plannedUpdates.length,
    notBoilerplate: report.filter((r) => r.status === 'not_boilerplate').length,
    notRichterFamily: report.filter((r) => r.status === 'not_richter_family').length,
    unresolvedCollegeName: report.filter((r) => r.status === 'unresolved_college_name').length,
    noop: report.filter((r) => r.status === 'noop').length,
  };

  if (options.apply && plannedUpdates.length > 0) {
    await ResearchEntity.bulkWrite(
      plannedUpdates.map((update) => ({
        updateOne: { filter: { _id: update.recordId }, update: { $set: update.set } },
      })),
      { ordered: false },
    );
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: plannedUpdates.map((update) => update.recordId),
    });
    await applyStudentVisibilityGatePlans(plans);

    const updatedDocs = await ResearchEntity.find({
      _id: { $in: plannedUpdates.map((update) => update.recordId) },
    }).lean();
    const byEntityType = new Map<string, any[]>();
    for (const doc of updatedDocs) {
      const key = String(doc.entityType);
      const bucket = byEntityType.get(key) || [];
      bucket.push(doc);
      byEntityType.set(key, bucket);
    }
    for (const [, docs] of byEntityType) {
      await syncEntities('researchEntity', docs);
    }
  }

  console.log(JSON.stringify({ summary, entries: report }, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(
        'Failed to backfill residential-college grant full descriptions:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
