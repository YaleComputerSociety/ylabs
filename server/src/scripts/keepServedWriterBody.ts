import { Observation } from '../models/observation';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { resetDescriptionOwnershipCitersCache } from '../scrapers/descriptionOwnershipResolverScreen';

export const KEEP_SERVED_WRITER_BODY_REASON_PREFIX = 'refused-written-body-kept-served';

export const keepServedWriterBodyReason = (contractVersion: string): string =>
  `${KEEP_SERVED_WRITER_BODY_REASON_PREFIX}:${contractVersion}`;

export interface KeepServedWriterBodyInput {
  anchors: readonly Record<string, unknown>[];
  sourceName: string;
  servedBody: string;
  refusedBody: string;
  reason: string;
}

/**
 * A written body the materializer refused must not displace the written body the row was
 * serving (#6485). Appending the new body supersedes the earlier one at ingest, so a refusal
 * at materialize would leave the row with nothing; this undoes exactly that supersede: the
 * refused observation is retired with a reason and the served one is live again.
 */
export async function keepServedWriterBody(
  input: KeepServedWriterBodyInput,
): Promise<{ restored: boolean }> {
  if (!input.servedBody.trim() || input.servedBody === input.refusedBody) return { restored: false };
  const scope = {
    entityType: 'researchEntity',
    ...materializationReadScopeFilter(),
    sourceName: input.sourceName,
    field: 'fullDescription',
    $or: [...input.anchors],
  };
  const served = (await Observation.findOne({ ...scope, value: input.servedBody, superseded: true })
    .sort({ observedAt: -1 })
    .select('_id')
    .lean()) as { _id: unknown } | null;
  const refused = (await Observation.findOne({ ...scope, value: input.refusedBody, superseded: false })
    .sort({ observedAt: -1 })
    .select('_id')
    .lean()) as { _id: unknown } | null;
  if (!served || !refused) return { restored: false };
  await Observation.updateOne(
    { _id: refused._id, superseded: false },
    { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: input.reason } } },
  );
  await Observation.updateOne({ _id: served._id, superseded: true }, { $set: { superseded: false } });
  resetDescriptionOwnershipCitersCache();
  return { restored: true };
}
