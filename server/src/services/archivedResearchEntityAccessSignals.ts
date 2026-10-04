import mongoose from 'mongoose';
import { attributedArchiveSet } from '../models/entityArchival';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { serializedDocumentId } from '../utils/idSerialization';

// Changing this also requires updating `activeAccessSignalsOnArchivedEntitiesPipeline`, which
// counts the access-typed subset of the signals this predicate selects (#4816).
export const LIVE_ACCESS_SIGNAL_FILTER = { archived: { $ne: true } } as const;

export interface AccessSignalOnArchivedEntity {
  id: string;
  archivedEntityId: string;
  signalType: string;
  derivationKey: string;
}

export interface SurvivorAccessSignal {
  id: string;
  survivorId: string;
  signalType: string;
  derivationKey: string;
}

export type AccessSignalSettlement =
  | { action: 'relink'; signalId: string; archivedEntityId: string; survivorId: string }
  | {
      action: 'merge-and-archive';
      signalId: string;
      archivedEntityId: string;
      survivorId: string;
      survivorSignalId: string;
    }
  | { action: 'archive'; signalId: string; archivedEntityId: string };

export interface AccessSignalSettlementCounts {
  relinked: number;
  mergedIntoSurvivor: number;
  archivedAsDuplicate: number;
  archivedWithoutSurvivor: number;
}

export interface AccessSignalSettlementOutcome extends AccessSignalSettlementCounts {
  refusedSurvivorNotLive: number;
}

export const emptyAccessSignalSettlementCounts = (): AccessSignalSettlementCounts => ({
  relinked: 0,
  mergedIntoSurvivor: 0,
  archivedAsDuplicate: 0,
  archivedWithoutSurvivor: 0,
});

export const emptyAccessSignalSettlementOutcome = (): AccessSignalSettlementOutcome => ({
  ...emptyAccessSignalSettlementCounts(),
  refusedSurvivorNotLive: 0,
});

const identityKey = (survivorId: string, signalType: string, derivationKey: string): string => {
  const type = signalType.trim();
  const key = derivationKey.trim();
  return type && key ? `${survivorId}:${type}:${key}` : '';
};

// The survivor's signals count whether archived or not, because the unique index on
// (researchEntityId, type, derivationKey) refuses a relink beside an archived one too.
// A signal moved here counts as held, so two archived rows never hand the survivor the
// same derivation twice.
export function planAccessSignalSettlements({
  signals,
  survivorIdFor,
  survivorSignals,
}: {
  signals: readonly AccessSignalOnArchivedEntity[];
  survivorIdFor: (archivedEntityId: string) => string | undefined;
  survivorSignals: readonly SurvivorAccessSignal[];
}): AccessSignalSettlement[] {
  const heldSignalIdByKey = new Map<string, string>();
  for (const signal of survivorSignals) {
    const key = identityKey(signal.survivorId, signal.signalType, signal.derivationKey);
    if (key && !heldSignalIdByKey.has(key)) heldSignalIdByKey.set(key, signal.id);
  }

  return signals.map((signal): AccessSignalSettlement => {
    const survivorId = survivorIdFor(signal.archivedEntityId);
    if (!survivorId) {
      return { action: 'archive', signalId: signal.id, archivedEntityId: signal.archivedEntityId };
    }
    const key = identityKey(survivorId, signal.signalType, signal.derivationKey);
    const survivorSignalId = key ? heldSignalIdByKey.get(key) : undefined;
    if (survivorSignalId) {
      return {
        action: 'merge-and-archive',
        signalId: signal.id,
        archivedEntityId: signal.archivedEntityId,
        survivorId,
        survivorSignalId,
      };
    }
    if (key) heldSignalIdByKey.set(key, signal.id);
    return {
      action: 'relink',
      signalId: signal.id,
      archivedEntityId: signal.archivedEntityId,
      survivorId,
    };
  });
}

const objectIdOf = (value: unknown): mongoose.Types.ObjectId | undefined => {
  const id = serializedDocumentId(value);
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
};

const objectIdsOf = (values: readonly unknown[]): mongoose.Types.ObjectId[] =>
  values.map(objectIdOf).filter((id): id is mongoose.Types.ObjectId => Boolean(id));

const textOf = (value: unknown): string => serializedDocumentId(value) || '';

async function archiveSignal(
  signalId: mongoose.Types.ObjectId,
  archivedEntityId: mongoose.Types.ObjectId,
  archivedReason: string,
  now: Date,
): Promise<number> {
  const result = await Signal.updateOne(
    { _id: signalId, researchEntityId: archivedEntityId, ...LIVE_ACCESS_SIGNAL_FILTER },
    { $set: attributedArchiveSet(archivedReason, { archivedAt: now, lastMaterializedAt: now }) },
  );
  return result.modifiedCount ?? 0;
}

async function mergeEvidenceIntoSurvivorSignal(
  signalId: mongoose.Types.ObjectId,
  survivorSignalId: mongoose.Types.ObjectId,
  now: Date,
): Promise<number> {
  const duplicate = (await Signal.findById(signalId).select('source.evidenceIds').lean()) as {
    source?: { evidenceIds?: unknown[] };
  } | null;
  const evidenceIds = duplicate?.source?.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) return 0;
  const result = await Signal.updateOne(
    { _id: survivorSignalId, ...LIVE_ACCESS_SIGNAL_FILTER },
    {
      $addToSet: { 'source.evidenceIds': { $each: evidenceIds } },
      $set: { lastMaterializedAt: now },
    },
  );
  return result.modifiedCount ?? 0;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 11000;

export async function applyAccessSignalSettlements(
  settlements: readonly AccessSignalSettlement[],
  { archivedReason, now }: { archivedReason: string; now: Date },
): Promise<AccessSignalSettlementCounts> {
  const counts = emptyAccessSignalSettlementCounts();
  for (const settlement of settlements) {
    const signalId = objectIdOf(settlement.signalId);
    const archivedEntityId = objectIdOf(settlement.archivedEntityId);
    if (!signalId || !archivedEntityId) continue;
    if (settlement.action === 'relink') {
      const survivorId = objectIdOf(settlement.survivorId);
      if (!survivorId) continue;
      try {
        const result = await Signal.updateOne(
          { _id: signalId, researchEntityId: archivedEntityId, ...LIVE_ACCESS_SIGNAL_FILTER },
          { $set: { researchEntityId: survivorId, lastMaterializedAt: now } },
        );
        counts.relinked += result.modifiedCount ?? 0;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        counts.archivedAsDuplicate += await archiveSignal(
          signalId,
          archivedEntityId,
          archivedReason,
          now,
        );
      }
      continue;
    }
    if (settlement.action === 'merge-and-archive') {
      const survivorSignalId = objectIdOf(settlement.survivorSignalId);
      if (survivorSignalId) {
        counts.mergedIntoSurvivor += await mergeEvidenceIntoSurvivorSignal(
          signalId,
          survivorSignalId,
          now,
        );
      }
      counts.archivedAsDuplicate += await archiveSignal(
        signalId,
        archivedEntityId,
        archivedReason,
        now,
      );
      continue;
    }
    counts.archivedWithoutSurvivor += await archiveSignal(
      signalId,
      archivedEntityId,
      archivedReason,
      now,
    );
  }
  return counts;
}

type SignalRow = {
  _id: unknown;
  researchEntityId?: unknown;
  type?: unknown;
  derivationKey?: unknown;
};

// Only rows that are archived, so an archive write that matched nothing cannot retire the
// signals of a row that is still live.
export async function loadLiveAccessSignalsOnArchivedEntities(
  archivedEntityIds: readonly unknown[],
): Promise<AccessSignalOnArchivedEntity[]> {
  const ids = objectIdsOf(archivedEntityIds);
  if (ids.length === 0) return [];
  const archived = await ResearchEntity.find({ _id: { $in: ids }, archived: true })
    .select('_id')
    .lean();
  const archivedIds = objectIdsOf(archived.map((row) => (row as { _id?: unknown })._id));
  if (archivedIds.length === 0) return [];
  const rows = (await Signal.find({
    researchEntityId: { $in: archivedIds },
    ...LIVE_ACCESS_SIGNAL_FILTER,
  })
    .sort({ _id: 1 })
    .select('_id researchEntityId type derivationKey')
    .lean()) as SignalRow[];
  return rows.map((row) => ({
    id: textOf(row._id),
    archivedEntityId: textOf(row.researchEntityId),
    signalType: textOf(row.type),
    derivationKey: textOf(row.derivationKey),
  }));
}

export async function loadSurvivorAccessSignals(
  survivorIds: readonly unknown[],
): Promise<SurvivorAccessSignal[]> {
  const survivors = objectIdsOf(survivorIds);
  if (survivors.length === 0) return [];
  const rows = (await Signal.find({ researchEntityId: { $in: survivors } })
    .sort({ _id: 1 })
    .select('_id researchEntityId type derivationKey')
    .lean()) as SignalRow[];
  return rows.map((row) => ({
    id: textOf(row._id),
    survivorId: textOf(row.researchEntityId),
    signalType: textOf(row.type),
    derivationKey: textOf(row.derivationKey),
  }));
}

// A survivor that is not live is refused, matching the role-edge settlement: relinking onto
// another archived row strands the signal again, and archiving it would discard the merge.
export async function settleAccessSignalsOfArchivedResearchEntities({
  archivedEntityIds,
  archivedReason,
  survivorId,
  now = new Date(),
}: {
  archivedEntityIds: readonly unknown[];
  archivedReason: string;
  survivorId?: unknown;
  now?: Date;
}): Promise<AccessSignalSettlementOutcome> {
  const outcome = emptyAccessSignalSettlementOutcome();
  const signals = await loadLiveAccessSignalsOnArchivedEntities(archivedEntityIds);
  if (signals.length === 0) return outcome;

  const survivor =
    survivorId === undefined || survivorId === null ? undefined : objectIdOf(survivorId);
  if (survivorId !== undefined && survivorId !== null) {
    const survivorIsLive =
      survivor !== undefined &&
      (await ResearchEntity.exists({ _id: survivor, archived: { $ne: true } })) !== null;
    if (!survivorIsLive) {
      outcome.refusedSurvivorNotLive = signals.length;
      return outcome;
    }
  }

  const survivorKey = survivor ? String(survivor) : undefined;
  const settlements = planAccessSignalSettlements({
    signals,
    survivorIdFor: () => survivorKey,
    survivorSignals: survivor ? await loadSurvivorAccessSignals([survivor]) : [],
  });
  return {
    ...outcome,
    ...(await applyAccessSignalSettlements(settlements, { archivedReason, now })),
  };
}
