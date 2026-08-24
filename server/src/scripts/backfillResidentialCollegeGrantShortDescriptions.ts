/**
 * Data repair for #1557: every Yale residential-college Mellon Senior Research
 * Grant entity shared one verbatim, non-distinguishing shortDescription ("To
 * provide funding to off-set the costs associated with a senior research
 * project or senior essay."), and every Richter Summer Fellowship entity but
 * one shared a second boilerplate short verbatim, so a student browsing
 * /research could not tell one college's grant/fellowship from another on the
 * card. The Richter family's Berkeley outlier does not carry the shared text
 * at all - a scrape-boundary artifact grabbed a mid-document section header
 * ("Amounts and uses of grant funding: ...") instead of a real description -
 * but still needs the same distinguishing per-college replacement, so it is
 * matched by displayName shape rather than by its current text.
 *
 * Derives each entity's own residential college from its displayName and
 * writes a distinguishing shortDescription naming that college. The applied
 * field is locked via manuallyLockedFields so a future scraper/backfill pass
 * cannot silently revert it to the shared template.
 *
 * Dry-run by default.
 *   yarn --cwd server tsx src/scripts/backfillResidentialCollegeGrantShortDescriptions.ts
 *   yarn --cwd server tsx src/scripts/backfillResidentialCollegeGrantShortDescriptions.ts \
 *     --apply --confirm-residential-college-grant-short-description-backfill
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
  buildResidentialCollegeGrantShortDescription,
  buildRichterFellowshipShortDescription,
  deriveResidentialCollegeName,
  deriveRichterFellowshipCollegeName,
  isResidentialCollegeGrantBoilerplateShortDescription,
  isRichterFellowshipFamilyDisplayName,
} from './backfillResidentialCollegeGrantShortDescriptionsCore';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-residential-college-grant-short-description-backfill') {
      options.confirm = true;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(
      '--confirm-residential-college-grant-short-description-backfill is required when --apply is set.',
    );
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillResidentialCollegeGrantShortDescriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const mellonCandidates: any[] = await ResearchEntity.find({
    shortDescription: { $regex: /off-?set the costs associated with a senior research project/i },
  })
    .select('_id entityType displayName shortDescription manuallyLockedFields')
    .lean();

  const richterCandidates: any[] = await ResearchEntity.find({
    displayName: { $regex: /Richter/i },
    entityType: 'FELLOWSHIP_PROGRAM',
  })
    .select('_id entityType displayName shortDescription manuallyLockedFields')
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
    shortDescription: string,
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
    if (shortDescription === entity.shortDescription) {
      report.push({ recordId, displayName: entity.displayName, status: 'noop' });
      return;
    }
    const lockedFields = Array.from(
      new Set([...(Array.isArray(entity.manuallyLockedFields) ? entity.manuallyLockedFields : []), 'shortDescription']),
    );
    planned.add(recordId);
    plannedUpdates.push({
      recordId,
      entityType: entity.entityType,
      set: { shortDescription, manuallyLockedFields: lockedFields },
    });
    report.push({
      recordId,
      displayName: entity.displayName,
      status: 'planned',
      collegeName,
      from: entity.shortDescription,
      to: shortDescription,
    });
  };

  for (const entity of mellonCandidates) {
    const matches = isResidentialCollegeGrantBoilerplateShortDescription(entity.shortDescription);
    const collegeName = matches ? deriveResidentialCollegeName(entity.displayName) : '';
    const shortDescription = collegeName
      ? buildResidentialCollegeGrantShortDescription(collegeName)
      : '';
    plan(entity, matches, 'not_boilerplate', collegeName, shortDescription);
  }

  for (const entity of richterCandidates) {
    const matches = isRichterFellowshipFamilyDisplayName(entity.displayName);
    const collegeName = matches ? deriveRichterFellowshipCollegeName(entity.displayName) : '';
    const shortDescription = collegeName ? buildRichterFellowshipShortDescription(collegeName) : '';
    plan(entity, matches, 'not_richter_family', collegeName, shortDescription);
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
        'Failed to backfill residential-college grant short descriptions:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
