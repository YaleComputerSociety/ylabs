import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchPlan } from '../models/researchPlan';
import {
  walkResearchEntityTombstoneChainWithCause,
  type ResearchEntityTombstoneNode,
} from './researchEntityCanonicalTombstone';
import {
  addResearchPlanCarryReports,
  carryResearchPlansToSurvivor,
  emptyResearchPlanCarryReport,
  type ResearchPlanCarryReport,
} from './researchPlanMergeCarry';

export interface ResearchPlanSurvivorRetargetReport {
  archivedTargets: number;
  mergedTargets: number;
  retiredTargets: number;
  survivors: number;
  carry: ResearchPlanCarryReport;
}

const findEntityById = async (id: string): Promise<ResearchEntityTombstoneNode | null> =>
  mongoose.Types.ObjectId.isValid(id)
    ? ((await ResearchEntity.findOne({ _id: new mongoose.Types.ObjectId(id) })
        .select('_id archived canonicalGroupId')
        .lean()) as ResearchEntityTombstoneNode | null)
    : null;

/**
 * Plans are environment-local (#5092), so a merge recorded in Development can only carry
 * Development's plans. Each serving environment runs this after a promotion copies the
 * merge in, so a student's saved plan follows the duplicate to its live survivor instead of
 * reading as unavailable (#5208).
 */
export async function retargetResearchPlansToMergeSurvivors(input: {
  apply: boolean;
}): Promise<ResearchPlanSurvivorRetargetReport> {
  const report: ResearchPlanSurvivorRetargetReport = {
    archivedTargets: 0,
    mergedTargets: 0,
    retiredTargets: 0,
    survivors: 0,
    carry: emptyResearchPlanCarryReport(),
  };
  const targetIds = await ResearchPlan.distinct('target.id', { 'target.kind': 'RESEARCH_ENTITY' });
  if (targetIds.length === 0) return report;
  const archivedTargets = (await ResearchEntity.find({ _id: { $in: targetIds }, archived: true })
    .select('_id archived canonicalGroupId')
    .lean()) as ResearchEntityTombstoneNode[];
  report.archivedTargets = archivedTargets.length;

  const duplicatesBySurvivor = new Map<string, mongoose.Types.ObjectId[]>();
  for (const archived of archivedTargets) {
    const { canonical } = await walkResearchEntityTombstoneChainWithCause(archived, {
      findById: findEntityById,
    });
    if (!canonical) {
      report.retiredTargets += 1;
      continue;
    }
    report.mergedTargets += 1;
    const key = String(canonical._id);
    duplicatesBySurvivor.set(key, [...(duplicatesBySurvivor.get(key) ?? []), archived._id]);
  }
  report.survivors = duplicatesBySurvivor.size;

  for (const [survivorId, duplicateIds] of duplicatesBySurvivor) {
    report.carry = addResearchPlanCarryReports(
      report.carry,
      await carryResearchPlansToSurvivor({ survivorId, duplicateIds, apply: input.apply }),
    );
  }
  return report;
}
