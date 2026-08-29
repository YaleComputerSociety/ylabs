import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from './studentVisibilityGateService';

export interface MergeSurvivorVisibilityRepair {
  survivorEntityId?: string;
  regated: boolean;
  tierBefore?: string;
  tierAfter?: string;
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);

function toSurvivorObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!mongoose.Types.ObjectId.isValid(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

function isPubliclyServable(tier: unknown): boolean {
  return typeof tier === 'string' && PUBLIC_TIERS.has(tier);
}

/**
 * Re-gates a merge survivor that is left non-servable, clearing a suppression
 * reason that was only true while the archived twin still existed
 * (`duplicate_risk` / `exact_url_duplicate_risk`). Without this, both slugs 404
 * after a merge: the survivor is suppressed, and `resolveArchivedResearchEntityCanonicalSlug`
 * refuses a redirect target that is not itself publicly servable (issue #2210).
 *
 * Ordering constraint: this must run AFTER the duplicates are archived. The gate
 * derives duplicate risk from the live (non-archived) corpus, so re-gating any
 * earlier would recompute the very risk the merge just eliminated.
 *
 * Deliberately scoped to non-servable survivors: a servable survivor has no lost
 * page to recover, and the gate plan for a single record still scans the whole
 * live corpus for duplicate references, which would be paid once per merge group
 * in a 500-merge sweep stage.
 */
export async function repairMergeSurvivorVisibility(
  survivorEntityId: mongoose.Types.ObjectId | string,
): Promise<MergeSurvivorVisibilityRepair> {
  const survivorId = toSurvivorObjectId(survivorEntityId);
  if (!survivorId) return { regated: false };

  const survivor = await ResearchEntity.findById(survivorId)
    .select('_id archived studentVisibilityTier')
    .lean<{ archived?: boolean; studentVisibilityTier?: string } | null>();
  const unchanged: MergeSurvivorVisibilityRepair = {
    survivorEntityId: String(survivorId),
    regated: false,
    tierBefore: survivor?.studentVisibilityTier,
  };
  if (!survivor || survivor.archived === true) return unchanged;
  if (isPubliclyServable(survivor.studentVisibilityTier)) return unchanged;

  const plans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'apply',
    recordIds: [String(survivorId)],
  });
  await applyStudentVisibilityGatePlans(plans);

  return { ...unchanged, regated: true, tierAfter: plans[0]?.tier };
}
