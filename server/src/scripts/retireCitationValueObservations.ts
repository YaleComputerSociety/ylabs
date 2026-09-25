import mongoose from 'mongoose';
import { Observation } from '../models/observation';

/**
 * Retires the observations that ASSERT a withdrawn citation, so a stripped field is not
 * restored by the next projection.
 *
 * Two sibling lanes already did this (`retireGraftedDirectoryUrls`,
 * `retireUmbrellaPageWebsiteUrls`); the four citation repairs stripped the field and left
 * the assertion standing, which is why the value came back. The capability was always
 * available, so the "blocked on the retraction gap" reading of those four was stale
 * (#3362).
 *
 * A scalar assertion IS the withdrawn value, so it is superseded whole. A `sourceUrls`
 * assertion is a list that usually also carries live citations, so its value is REWRITTEN
 * to drop the withdrawn entries and superseded only when nothing survives. Retiring the
 * whole list observation would discard the live citations it asserts alongside the dead
 * one, which is the same over-reach as deleting a row to remove one field.
 *
 * Observations merely CITED TO a withdrawn URL are deliberately untouched and counted
 * instead. A page that has since died still said what it said when it was read, so
 * retiring those would destroy evidence rather than withdraw a claim. An entity-level zero
 * hides that population, so it is reported.
 */
export interface CitationObservationRetirement {
  scalarSuperseded: number;
  listsRewritten: number;
  listsSupersededEmpty: number;
  citedToWithdrawnUrlLeftAlone: number;
}

export function planCitationListRewrite(
  value: unknown,
  withdrawn: ReadonlySet<string>,
): { kept: string[]; removed: string[] } | null {
  if (!Array.isArray(value)) return null;
  const urls = value.filter((entry): entry is string => typeof entry === 'string');
  const removed = urls.filter((url) => withdrawn.has(url));
  if (removed.length === 0) return null;
  return { kept: urls.filter((url) => !withdrawn.has(url)), removed };
}

export async function retireCitationValueObservations(input: {
  entityKeys: readonly string[];
  withdrawnUrls: readonly string[];
  reason: string;
  apply: boolean;
}): Promise<CitationObservationRetirement> {
  const result: CitationObservationRetirement = {
    scalarSuperseded: 0,
    listsRewritten: 0,
    listsSupersededEmpty: 0,
    citedToWithdrawnUrlLeftAlone: 0,
  };
  if (input.entityKeys.length === 0 || input.withdrawnUrls.length === 0) return result;
  const withdrawn = new Set(input.withdrawnUrls);
  const scope = {
    entityType: 'researchEntity' as const,
    entityKey: { $in: [...input.entityKeys] },
    superseded: { $ne: true },
  };
  const rollback = { rolledBackAt: new Date(), reason: input.reason };

  const scalar = (await Observation.find({
    ...scope,
    field: { $in: ['websiteUrl', 'website'] },
    value: { $in: [...withdrawn] },
  })
    .select('_id')
    .lean()) as Array<{ _id: unknown }>;
  if (scalar.length > 0 && input.apply) {
    const written = await Observation.updateMany(
      { _id: { $in: scalar.map((row) => new mongoose.Types.ObjectId(String(row._id))) } },
      { $set: { superseded: true, rollback } },
    );
    result.scalarSuperseded = written.modifiedCount || 0;
  } else result.scalarSuperseded = scalar.length;

  const lists = (await Observation.find({ ...scope, field: 'sourceUrls' })
    .select('_id value')
    .lean()) as Array<{ _id: unknown; value?: unknown }>;
  for (const row of lists) {
    const plan = planCitationListRewrite(row.value, withdrawn);
    if (!plan) continue;
    if (plan.kept.length === 0) {
      result.listsSupersededEmpty += 1;
      if (input.apply) {
        await Observation.updateOne(
          { _id: new mongoose.Types.ObjectId(String(row._id)) },
          { $set: { superseded: true, rollback } },
        );
      }
      continue;
    }
    result.listsRewritten += 1;
    if (input.apply) {
      await Observation.updateOne(
        { _id: new mongoose.Types.ObjectId(String(row._id)) },
        { $set: { value: plan.kept } },
      );
    }
  }

  result.citedToWithdrawnUrlLeftAlone = await Observation.countDocuments({
    entityType: 'researchEntity',
    sourceUrl: { $in: [...withdrawn] },
    superseded: { $ne: true },
  });
  return result;
}
