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
  const addDuplicate = (survivorId: string, duplicateId: mongoose.Types.ObjectId) =>
    duplicatesBySurvivor.set(survivorId, [
      ...(duplicatesBySurvivor.get(survivorId) ?? []),
      duplicateId,
    ]);

  // Beta and Production hold no archived rows (#5148), so a plan there points at an id
  // that no row carries, and its survivor is the live row naming it in `mergedFrom`.
  const presentIds = new Set(
    (
      await ResearchEntity.find({ _id: { $in: targetIds } })
        .select('_id')
        .lean()
    ).map((row: any) => String(row._id)),
  );
  const absentIds = targetIds.filter((id) => !presentIds.has(String(id)));
  if (absentIds.length > 0) {
    const survivors = (await ResearchEntity.find({
      archived: { $ne: true },
      'mergedFrom.entityId': { $in: absentIds },
    })
      .select('_id mergedFrom.entityId')
      .lean()) as Array<{
      _id: mongoose.Types.ObjectId;
      mergedFrom?: Array<{ entityId?: unknown }>;
    }>;
    const survivorByMergedId = new Map<string, string>();
    for (const survivor of survivors) {
      for (const entry of survivor.mergedFrom ?? []) {
        survivorByMergedId.set(String(entry.entityId), String(survivor._id));
      }
    }
    for (const absentId of absentIds) {
      const survivorId = survivorByMergedId.get(String(absentId));
      if (!survivorId) {
        report.retiredTargets += 1;
        continue;
      }
      report.mergedTargets += 1;
      addDuplicate(survivorId, new mongoose.Types.ObjectId(String(absentId)));
    }
  }

  for (const archived of archivedTargets) {
    const { canonical } = await walkResearchEntityTombstoneChainWithCause(archived, {
      findById: findEntityById,
    });
    if (!canonical) {
      report.retiredTargets += 1;
      continue;
    }
    report.mergedTargets += 1;
    addDuplicate(String(canonical._id), archived._id);
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
