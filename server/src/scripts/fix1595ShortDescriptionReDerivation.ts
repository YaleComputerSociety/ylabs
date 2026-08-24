/**
 * Targeted backfill for the two confirmed-bad live docs behind #1595's
 * reopened short/full re-derivation gap:
 *
 * - Olin Research Center (`faculty-research-area-godfrey-pearlson`): PR #1669
 *   corrected `fullDescription` to the org-level mission statement, but
 *   `shortDescription` was never re-derived and still reads as the founding
 *   PI's single NIDA marijuana-driving grant abstract - a short/full
 *   contradiction.
 * - Impulsivity and Impulse Control Disorder Research Program
 *   (`nih-pi-marc-potenza`): the short-extraction pipeline's next-best
 *   candidate after PR #1618's location-fragment guard is a dangling
 *   grant-significance closer sentence ("This research has significant
 *   potential to inform..."), which the new `grant-significance-boilerplate`
 *   quality flag now rejects, but the derivation pipeline cannot produce a
 *   grounded replacement for this entity without an LLM call (program-like
 *   entities never invoke the LLM synthesizer, and every other sentence in
 *   its own messy source prose fails a quality check).
 *
 * Both replacement values below are grounded entirely in each entity's own
 * `fullDescription` prose (verified against Development) and pass
 * `shortDescriptionQuality`/`programCardShortDescriptionQuality`. This script
 * only applies a correction when the entity's current `shortDescription`
 * still matches the exact known-bad value, so it is a no-op if either entity
 * has already moved on for an unrelated reason.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  programCardShortDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:fix-1595-short-description-re-derivation';

interface TargetedCorrection {
  entityId: string;
  slug: string;
  knownBadShortDescription: string;
  correctedShortDescription: string;
  isProgramLike: boolean;
}

const CORRECTIONS: TargetedCorrection[] = [
  {
    entityId: '6a057e2213fc60d57ec2aee7',
    slug: 'faculty-research-area-godfrey-pearlson',
    knownBadShortDescription:
      'Examines the acute effects of various doses of smoked marijuana versus placebo on simulated motor vehicle driving and neurocognitive paradigms, alongside biological measures of THC and metabolites.',
    correctedShortDescription:
      'Studies the neuroscience of psychiatric illnesses to advance effective treatments.',
    isProgramLike: false,
  },
  {
    entityId: '6a6470b3b65d4cb51393aa4a',
    slug: 'nih-pi-marc-potenza',
    knownBadShortDescription:
      'This research has significant potential to inform about the pathophysiology of addictive disorders and for the development of targeted therapies for specific psychiatric conditions.',
    correctedShortDescription:
      'A Yale School of Medicine collaboration among interdisciplinary scientists studying behavioral and substance use addictions and their relation to impulse control.',
    isProgramLike: true,
  },
];

interface CorrectionReport {
  slug: string;
  found: boolean;
  matchedKnownBad?: boolean;
  currentShortDescription?: string;
  plannedShortDescription?: string;
  correctedQualityUseful?: boolean;
  applied?: boolean;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm-fix-1595-short-description');
  if (apply && !confirmed) {
    throw new Error('--confirm-fix-1595-short-description is required when --apply is set.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`);

  await mongoose.connect(process.env.MONGODBURL as string);

  const reports: CorrectionReport[] = [];
  const appliedIds: string[] = [];

  for (const correction of CORRECTIONS) {
    const doc = await ResearchEntity.findById(correction.entityId).select(
      'slug shortDescription fullDescription',
    );
    if (!doc) {
      reports.push({ slug: correction.slug, found: false });
      continue;
    }

    const currentShortDescription = doc.shortDescription ?? '';
    const matchedKnownBad = currentShortDescription.trim() === correction.knownBadShortDescription.trim();

    const qualityCheck = correction.isProgramLike
      ? programCardShortDescriptionQuality(correction.correctedShortDescription, doc.fullDescription)
      : shortDescriptionQuality(correction.correctedShortDescription, doc.fullDescription);

    const report: CorrectionReport = {
      slug: correction.slug,
      found: true,
      matchedKnownBad,
      currentShortDescription,
      plannedShortDescription: correction.correctedShortDescription,
      correctedQualityUseful: qualityCheck.isUseful,
    };

    if (!matchedKnownBad) {
      console.log(`skip ${correction.slug}: current shortDescription no longer matches known-bad value`);
      reports.push(report);
      continue;
    }
    if (!qualityCheck.isUseful) {
      console.log(`skip ${correction.slug}: corrected candidate failed its own quality gate: ${JSON.stringify(qualityCheck.flags)}`);
      reports.push(report);
      continue;
    }

    if (apply) {
      await ResearchEntity.updateOne(
        { _id: correction.entityId },
        {
          $set: {
            shortDescription: correction.correctedShortDescription,
            'confidenceByField.shortDescription': 1,
            'fieldProvenance.shortDescription': {
              sourceName: 'manual-fix-1595-short-full-contradiction',
              sourceUrl: '',
              observedAt: new Date(),
              confidence: 1,
            },
          },
        },
      );
      appliedIds.push(correction.entityId);
      report.applied = true;
    }

    reports.push(report);
  }

  if (apply && appliedIds.length > 0) {
    const updatedDocs = await ResearchEntity.find({ _id: { $in: appliedIds } }).lean();
    await syncEntities('researchEntity', updatedDocs as unknown[]);
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', reports }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
