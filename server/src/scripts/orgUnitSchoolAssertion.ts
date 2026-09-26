import mongoose from 'mongoose';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';

/**
 * Asserts an inferred school as evidence, so the value is reachable by a later retraction
 * instead of persisting because nothing clears it.
 *
 * Only `school` is asserted. `schools` and `orgAffiliationLabels` are computed from
 * `school` and `departments` by `applyResearchEntityOrgUnitCanonicalization`, so asserting
 * them would record a derived value as though a source had stated it (#3362).
 *
 * The direct `$set` these lanes already perform stays: `projectFromLog` builds its `$set`
 * from the resolved map only, so an observation appended here is not read until the next
 * projection and the row would serve nothing in between.
 *
 * A missing `Source` row is reported rather than thrown, because a lane must not break an
 * unseeded environment; the registration is pinned by the guard that every authored source
 * name resolves to a seeded source.
 */
export const INFERRED_SCHOOL_CONFIDENCE = 0.9;

export interface OrgUnitSchoolAssertion {
  observed: string[];
  skipped?: 'source-not-registered' | 'observation-refused' | 'nothing-to-assert';
}

export async function assertInferredSchoolObservation(
  input: {
    sourceName: string;
    entityId?: string;
    entityKey: string;
    school: string;
    evidenceUrl: string;
    confidence: number;
  },
  deps: { getSource?: typeof getSourceByName; append?: typeof appendObservations } = {},
): Promise<OrgUnitSchoolAssertion> {
  if (!input.school.trim() || !input.entityKey.trim() || !input.evidenceUrl.trim()) {
    return { observed: [], skipped: 'nothing-to-assert' };
  }
  const source = await (deps.getSource ?? getSourceByName)(input.sourceName);
  if (!source) return { observed: [], skipped: 'source-not-registered' };
  const appended = await (deps.append ?? appendObservations)(
    [
      {
        entityType: 'researchEntity' as const,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        entityKey: input.entityKey,
        field: 'school',
        value: input.school,
        sourceUrl: input.evidenceUrl,
        confidenceOverride: input.confidence,
      },
    ],
    {
      sourceId: source._id,
      sourceName: input.sourceName,
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceWeight: input.confidence,
      dryRun: false,
    },
  );
  return appended.inserted > 0
    ? { observed: ['school'] }
    : { observed: [], skipped: 'observation-refused' };
}

/**
 * Re-backs rows a previous pass wrote before these lanes appended observations.
 *
 * Both lanes gate on an EMPTY school, which is every row they already filled, so
 * re-running cannot re-back their own output - the same shape #3375 found in the lead-PI
 * lane. Backing is established only on reproduction: asserting the stored value because it
 * is stored would manufacture evidence for a value whose origin cannot be established.
 */
export function planInferredSchoolReback(input: {
  storedSchool: unknown;
  rederivedSchool: string;
  alreadyObserved: boolean;
}): 'reproduced' | 'value-diverged' | 'not-reproducible' | 'already-observed' {
  if (input.alreadyObserved) return 'already-observed';
  if (!input.rederivedSchool) return 'not-reproducible';
  return typeof input.storedSchool === 'string' && input.storedSchool === input.rederivedSchool
    ? 'reproduced'
    : 'value-diverged';
}
