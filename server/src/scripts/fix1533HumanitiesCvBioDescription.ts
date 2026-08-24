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
  isDefectiveShortDescription,
  repairPersonBiographyLeakedDescription,
} from '../utils/researchEntityBiographyDescriptionRepair';
import { describesResearchFocus } from '../utils/researchEntityDescriptionQuality';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const INDIVIDUAL_OR_LAB_ENTITY_TYPES = new Set(['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH', 'LAB']);

/**
 * #1533's cohort: within a person or lab entity (never a PROGRAM/FELLOWSHIP
 * entity - those describe program logistics in language that superficially
 * resembles CV markers, e.g. "under the supervision of a faculty mentor",
 * without ever being a faculty bio leak), a raw faculty-bio degree-list
 * lead, a description carrying two or more education/career-timeline
 * sentences regardless of department or school, a defective stored short
 * (citation fragment, bare chair-title clause), or a description with zero
 * research-topic signal (award/teaching-history/CV prose only). The
 * original version of this gate was scoped to a literal "humanities
 * faculty" framing (degree-list lead or no-research-signal-at-all) that
 * missed the FAS/Medicine/Management/Law rows reopening #1533 called out -
 * those rows describe real research *and* carry a CV/bio-dominated
 * fullDescription, so describesResearchFocus alone never flagged them
 * (#1533 reopen: Ray Fair's, Jaynes', Benhabib's, and HoSang's
 * fullDescriptions all describe genuine research yet are dominated by
 * prior-employment, society-fellow, department-chair, or prize-list CV
 * sentences). hasMultipleCareerTimelineSentences is department/school-
 * agnostic by construction, so this gate no longer needs a humanities
 * carve-out - only the pre-existing individual/lab entity-type carve-out.
 */
function isCvBiographyLeakCandidate(entity: Record<string, any>): boolean {
  const isIndividualOrLab =
    entity.kind === 'individual' || INDIVIDUAL_OR_LAB_ENTITY_TYPES.has(String(entity.entityType || ''));
  if (!isIndividualOrLab) return false;

  const full = typeof entity.fullDescription === 'string' ? entity.fullDescription : '';
  const short = typeof entity.shortDescription === 'string' ? entity.shortDescription : '';
  if (short && isDefectiveShortDescription(short)) return true;
  if (!full) return false;
  if (hasLeadingDegreeListSignal(full)) return true;
  if (hasProfileFieldLabelChromeSignal(full)) return true;
  if (hasMultipleCareerTimelineSentences(full)) return true;
  if (!describesResearchFocus(full)) return true;
  // describesResearchFocus has known false positives on CV/résumé phrasing
  // that happens to share vocabulary with research-focus language (#1533:
  // braverman-lab-ericb's "a career focused on innovation, leadership,
  // institutional transformation, and social impact" trips the shared
  // hasResearchDescriptionVerb "focused on" alternative even though it
  // describes an executive résumé, not research). An entity with no
  // structured researchAreas has nothing to fall back on if the repair
  // function's own, more careful judgment decides the prose has no
  // salvageable research content either, so it's worth scanning regardless
  // of that shared heuristic's verdict.
  const hasNoResearchAreas = !Array.isArray(entity.researchAreas) || entity.researchAreas.length === 0;
  return hasNoResearchAreas;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1533');
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

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  if (apply && !confirmed) {
    console.error('--confirm-fix-1533 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix1533HumanitiesCvBioDescription',
    mongoUrl: uri,
  });
  console.error(`Target: ${guard.environment} / ${guard.dbLabel}`);

  await initializeConnections();

  // Scope: live student_ready entities matching the #1533 CV/bio-leak shape,
  // across any department or school - not #1456's kind:lab cohort (already
  // covered) and not a blanket re-run of the repair function over every
  // entity (see isCvBiographyLeakCandidate for why that's unsafe).
  const scanned = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    fullDescription: { $type: 'string', $ne: '' },
  })
    .select('_id slug kind entityType shortDescription fullDescription researchAreas')
    .lean();
  const candidates = scanned.filter(isCvBiographyLeakCandidate);

  console.error(
    `Scanned ${scanned.length} student_ready entities with a fullDescription, ${candidates.length} match the #1533 CV/bio-leak candidate shape`,
  );

  const repaired: RepairedRecord[] = [];
  for (const entity of candidates) {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    });
    if (result.outcome === 'unchanged') continue;
    repaired.push({
      id: String(entity._id),
      slug: entity.slug,
      outcome: result.outcome,
      oldShortDescription: typeof entity.shortDescription === 'string' ? entity.shortDescription : '',
      newShortDescription: result.shortDescription,
      oldFullDescription: typeof entity.fullDescription === 'string' ? entity.fullDescription : '',
      newFullDescription: result.fullDescription,
    });
  }

  const resynthesizedCount = repaired.filter((r) => r.outcome === 'resynthesized').length;
  const blankedCount = repaired.filter((r) => r.outcome === 'blanked').length;
  console.error(
    `Humanities CV/bio leak detected on ${repaired.length} entities (${resynthesizedCount} re-synthesized from real content, ${blankedCount} routed to no-description fallback)`,
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
    console.error('fix1533HumanitiesCvBioDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
