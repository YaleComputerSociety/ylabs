import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  hasLeadingDegreeListSignal,
  hasMultipleCareerTimelineSentences,
  hasProfileFieldLabelChromeSignal,
  repairPersonBiographyLeakedDescription,
} from '../utils/researchEntityBiographyDescriptionRepair';
import {
  isCredentialOrTitleLeadBiography,
  isDeceasedOrEmeritusLeadBiography,
  isPersonBiographyOrAdvisingDescription,
  repairBiographyOrDeceasedEmeritusLead,
} from '../utils/researchEntityDescriptionText';
import { collapseDoubledSynthesisVerb } from '../utils/descriptionHygiene';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1638');
const maxApplyArg = process.argv.find((arg) => arg.startsWith('--max-apply='));
const maxApply = maxApplyArg ? Number(maxApplyArg.slice('--max-apply='.length)) : 50;

interface RepairedRecord {
  id: string;
  slug: string;
  outcome: 'resynthesized' | 'blanked';
  oldShortDescription: string;
  newShortDescription: string;
  oldFullDescription: string;
  newFullDescription: string;
}

/**
 * A near-the-lead biography/CV signal on the fullDescription itself, not just
 * some incidental career-fact sentence buried mid-paragraph. Gates whether
 * the deep sentence-level detector (repairPersonBiographyLeakedDescription)
 * is even worth running on a given LAB row - that detector's education/
 * career-timeline sentence patterns can fire on a single stray sentence deep
 * inside an otherwise-fine, long research description (the same over-broad
 * risk #1533's own isHumanitiesCvBioCandidate pre-filter was written to
 * avoid), and its shortDescription-replacement fallback then discards a
 * perfectly good, unrelated short in that case. Restricting to entities that
 * ALSO show a lead-level signal keeps the LAB backfill's blast radius scoped
 * to the issue. A first-person CV dump rarely has that lead-level signal
 * (#1638: Allore Lab never names itself or opens on an appointment clause),
 * so hasMultipleCareerTimelineSentences is included as an alternate signal -
 * two or more career-timeline sentence matches anywhere in the text, which
 * is unlikely from a single incidental match in an otherwise-fine
 * description (verified against Hoh Lab and Pollard Lab, two first-person
 * LAB descriptions that describe genuine ongoing research and must not be
 * touched by this signal).
 */
function fullDescriptionHasLeadBiographySignal(full: unknown): boolean {
  return (
    isPersonBiographyOrAdvisingDescription(full) ||
    isDeceasedOrEmeritusLeadBiography(full) ||
    isCredentialOrTitleLeadBiography(full) ||
    hasLeadingDegreeListSignal(full) ||
    hasProfileFieldLabelChromeSignal(full) ||
    hasMultipleCareerTimelineSentences(full)
  );
}

/**
 * #1638's LAB cohort: the #1456/#1507/#1533 CV/bio detector's degree-list and
 * career-timeline sentence patterns only match a subset of live LAB
 * biography leaks - the same appointment-opener and deceased/emeritus-lead
 * shapes already guarded on FACULTY_RESEARCH_AREA/INDIVIDUAL_RESEARCH
 * entities (repairBiographyOrDeceasedEmeritusLead) were never extended to
 * entityType LAB. Only fall back to the deep sentence-level detector when
 * the fullDescription shows a lead-level signal (see
 * fullDescriptionHasLeadBiographySignal); when it does, use its rebuilt
 * fullDescription but decide the shortDescription independently via the same
 * narrow opener/deceased-emeritus guard applied to LAB's stored
 * shortDescription - never the deep detector's own short-replacement
 * fallback, which can discard an unrelated, perfectly good short whenever
 * only the full needed repair. Deliberately narrower than the full
 * served-field sanitizer: this never applies the unrelated first-person-
 * revoice/subjectless-lead repairs that read-time serving also performs, so
 * the backfill's blast radius matches the issue instead of baking unrelated
 * serve-time rewrites into stored data.
 */
function repairLabBiographyLeak(entity: Record<string, unknown>): {
  outcome: 'unchanged' | 'resynthesized' | 'blanked';
  fullDescription: string;
  shortDescription: string;
} {
  const entityShape = {
    entityType: entity.entityType == null ? undefined : String(entity.entityType),
    kind: entity.kind == null ? undefined : String(entity.kind),
  };
  const originalFull = typeof entity.fullDescription === 'string' ? entity.fullDescription : '';
  const originalShort = typeof entity.shortDescription === 'string' ? entity.shortDescription : '';

  const shouldRunDeepDetector = fullDescriptionHasLeadBiographySignal(originalFull);
  const deep = shouldRunDeepDetector
    ? repairPersonBiographyLeakedDescription({
        fullDescription: entity.fullDescription,
        shortDescription: entity.shortDescription,
        researchAreas: entity.researchAreas,
      })
    : null;

  const fullAfterDeep = deep && deep.outcome !== 'unchanged' ? deep.fullDescription : originalFull;
  const fullRepair = repairBiographyOrDeceasedEmeritusLead(fullAfterDeep, entityShape);
  const shortRepair = repairBiographyOrDeceasedEmeritusLead(originalShort, entityShape);

  const finalFull = fullRepair.changed ? fullRepair.value : fullAfterDeep;
  const finalShort = shortRepair.changed ? shortRepair.value : originalShort;

  if (finalFull === originalFull && finalShort === originalShort) {
    return { outcome: 'unchanged', fullDescription: originalFull, shortDescription: originalShort };
  }
  return {
    outcome: finalFull || finalShort ? 'resynthesized' : 'blanked',
    fullDescription: finalFull,
    shortDescription: finalShort,
  };
}

/**
 * A doubled synthesis-verb short lead ("Studies Studies on Chitinases...")
 * that predates (or otherwise bypassed) collapseDoubledSynthesisVerb - the
 * card-serving path already collapses this on every read
 * (sanitizeResearchEntityShortDescription calls collapseDoubledSynthesisVerb
 * internally), but the stored field itself is left uncorrected forever
 * unless something rewrites it (#1638: ysm-takyar). Deliberately calls
 * collapseDoubledSynthesisVerb directly rather than the full
 * sanitizeResearchEntityShortDescription chain: the latter also blanks raw
 * first-person voice, chrome, and other unrelated defects that are out of
 * scope for this backfill.
 */
function hasDoubledSynthesisVerbLead(shortDescription: unknown): boolean {
  const text = typeof shortDescription === 'string' ? shortDescription : '';
  if (!text) return false;
  return collapseDoubledSynthesisVerb(text) !== text;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  if (apply && !confirmed) {
    console.error('--confirm-fix-1638 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix1638LabCvBioFullDescription',
    mongoUrl: uri,
  });
  console.error(`Target: ${guard.environment} / ${guard.dbLabel}`);

  await initializeConnections();

  // Scope: student_ready LAB entities with a biography/CV leak in either
  // description field, plus any student_ready row whose stored
  // shortDescription still carries a doubled synthesis-verb lead the
  // serve-time sanitizer would otherwise collapse on every read.
  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    $or: [
      { entityType: 'LAB', fullDescription: { $type: 'string', $ne: '' } },
      { shortDescription: { $regex: /^(Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds)\s+\1\b/i } },
    ],
  })
    .select('_id slug entityType kind shortDescription fullDescription researchAreas')
    .lean();

  console.error(`Scanned ${candidates.length} student_ready candidate entities`);

  const repaired: RepairedRecord[] = [];
  for (const entity of candidates) {
    const isLab = entity.entityType === 'LAB';
    const doubledShort = hasDoubledSynthesisVerbLead(entity.shortDescription);

    let outcome: 'unchanged' | 'resynthesized' | 'blanked' = 'unchanged';
    let newFullDescription = typeof entity.fullDescription === 'string' ? entity.fullDescription : '';
    let newShortDescription = typeof entity.shortDescription === 'string' ? entity.shortDescription : '';

    if (isLab) {
      const result = repairLabBiographyLeak(entity);
      outcome = result.outcome;
      newFullDescription = result.fullDescription;
      newShortDescription = result.shortDescription;
    }

    if (doubledShort) {
      const collapsedShort = collapseDoubledSynthesisVerb(newShortDescription);
      if (collapsedShort !== newShortDescription) {
        newShortDescription = collapsedShort;
        if (outcome === 'unchanged') outcome = 'resynthesized';
      }
    }

    if (outcome === 'unchanged') continue;
    repaired.push({
      id: String(entity._id),
      slug: entity.slug,
      outcome,
      oldShortDescription: typeof entity.shortDescription === 'string' ? entity.shortDescription : '',
      newShortDescription,
      oldFullDescription: typeof entity.fullDescription === 'string' ? entity.fullDescription : '',
      newFullDescription,
    });
  }

  const resynthesizedCount = repaired.filter((r) => r.outcome === 'resynthesized').length;
  const blankedCount = repaired.filter((r) => r.outcome === 'blanked').length;
  console.error(
    `LAB PI-bio/CV leak or doubled-verb short detected on ${repaired.length} entities (${resynthesizedCount} re-synthesized from real content, ${blankedCount} routed to no-description fallback)`,
  );

  for (const record of repaired) {
    console.log(`${apply ? 'APPLY' : 'DRY-RUN'} [${record.outcome}] ${record.slug} (${record.id})`);
    console.log('  OLD SHORT:', JSON.stringify(record.oldShortDescription).slice(0, 200));
    console.log('  NEW SHORT:', JSON.stringify(record.newShortDescription).slice(0, 200));
    console.log('  OLD FULL: ', JSON.stringify(record.oldFullDescription).slice(0, 200));
    console.log('  NEW FULL: ', JSON.stringify(record.newFullDescription).slice(0, 200));
  }

  if (!apply) {
    await mongoose.disconnect();
    return;
  }
  if (repaired.length > maxApply) {
    console.error(
      `Apply would touch ${repaired.length} entities, above --max-apply=${maxApply}. Aborting without writes.`,
    );
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  for (const record of repaired) {
    await ResearchEntity.updateOne(
      { _id: record.id },
      {
        $set: {
          shortDescription: record.newShortDescription,
          fullDescription: record.newFullDescription,
        },
      },
    );
  }
  console.error(`Updated description fields on ${repaired.length} entities`);

  const touchedIds = repaired.map((record) => record.id);
  if (touchedIds.length > 0) {
    const gateReport = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    console.error(
      `Re-gated ${touchedIds.length} touched entities: ${JSON.stringify(gateReport.counts)}`,
    );

    const docs = await ResearchEntity.find({
      _id: { $in: touchedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${docs.length} entities to Meili`);
    await syncEntities('researchEntity', docs as any);
  }
}

main()
  .catch((error) => {
    console.error('fix1638LabCvBioFullDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
