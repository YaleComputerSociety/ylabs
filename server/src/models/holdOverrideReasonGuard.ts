import type mongoose from 'mongoose';
import { BadRequestError } from '../utils/errors';
import { holdingStudentVisibilityOverrideTiers, isHoldingOverrideTier } from './studentVisibility';

const TIER_FIELD = 'studentVisibilityOverrideTier';
const REASON_FIELD = 'studentVisibilitySuppressionReason';

export class HoldingOverrideWithoutReasonError extends BadRequestError {
  constructor() {
    super(
      `A holding ${TIER_FIELD} (suppressed or operator_review) needs a recorded ${REASON_FIELD}: record one with student-visibility:override (#5856).`,
    );
    this.name = 'HoldingOverrideWithoutReasonError';
    Object.setPrototypeOf(this, HoldingOverrideWithoutReasonError.prototype);
  }
}

export const hasRecordedOverrideReason = (value: unknown): boolean =>
  typeof value === 'string' && value.split(',').some((entry) => entry.trim().length > 0);

export const isHoldWithoutRecordedReason = (
  record: Record<string, unknown> | null | undefined,
): boolean =>
  isHoldingOverrideTier(record?.[TIER_FIELD]) && !hasRecordedOverrideReason(record?.[REASON_FIELD]);

const HELD_FILTER = {
  [TIER_FIELD]: { $in: [...holdingStudentVisibilityOverrideTiers] },
};

const UNRECORDED_REASON_FILTER = {
  $or: [
    { [REASON_FIELD]: { $exists: false } },
    { [REASON_FIELD]: null },
    { [REASON_FIELD]: { $regex: /^[\s,]*$/ } },
  ],
};

const notAlreadyReasonlessHold = (tier: unknown): Record<string, unknown> => ({
  $nor: [{ [TIER_FIELD]: tier, ...UNRECORDED_REASON_FILTER }],
});

type FieldWrite = { kind: 'untouched' } | { kind: 'assigned'; value: unknown };

function fieldWrite(update: Record<string, unknown>, field: string): FieldWrite {
  const unset = update.$unset as Record<string, unknown> | undefined;
  if (unset && field in unset) return { kind: 'assigned', value: undefined };
  for (const assignment of [update.$set, update.$setOnInsert, update]) {
    if (assignment && typeof assignment === 'object' && field in assignment) {
      return { kind: 'assigned', value: (assignment as Record<string, unknown>)[field] };
    }
  }
  return { kind: 'untouched' };
}

export type HoldReasonCheck =
  { verdict: 'allowed' } | { verdict: 'refused_if_any_match'; filter: Record<string, unknown> };

export function checkUpdateKeepsHoldReason(update: unknown): HoldReasonCheck {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return { verdict: 'allowed' };
  const record = update as Record<string, unknown>;
  const tier = fieldWrite(record, TIER_FIELD);
  const reason = fieldWrite(record, REASON_FIELD);
  if (tier.kind === 'assigned') {
    if (!isHoldingOverrideTier(tier.value)) return { verdict: 'allowed' };
    if (reason.kind === 'untouched') {
      return {
        verdict: 'refused_if_any_match',
        filter: { $and: [UNRECORDED_REASON_FILTER, { [TIER_FIELD]: { $ne: tier.value } }] },
      };
    }
    return hasRecordedOverrideReason(reason.value)
      ? { verdict: 'allowed' }
      : { verdict: 'refused_if_any_match', filter: notAlreadyReasonlessHold(tier.value) };
  }
  if (reason.kind === 'assigned' && !hasRecordedOverrideReason(reason.value)) {
    return {
      verdict: 'refused_if_any_match',
      filter: { $and: [HELD_FILTER, { $nor: [UNRECORDED_REASON_FILTER] }] },
    };
  }
  return { verdict: 'allowed' };
}

function checkReplacementKeepsHoldReason(document: unknown): HoldReasonCheck {
  if (!document || typeof document !== 'object') return { verdict: 'allowed' };
  const record = document as Record<string, unknown>;
  if (!isHoldWithoutRecordedReason(record)) return { verdict: 'allowed' };
  return { verdict: 'refused_if_any_match', filter: notAlreadyReasonlessHold(record[TIER_FIELD]) };
}

type ExistsModel = {
  exists(filter: Record<string, unknown>): { session(session: unknown): PromiseLike<unknown> };
};

async function enforceHoldReasonCheck(
  model: ExistsModel,
  filter: Record<string, unknown>,
  check: HoldReasonCheck,
  session: unknown,
): Promise<void> {
  if (check.verdict === 'allowed') return;
  const match = await model.exists({ $and: [filter ?? {}, check.filter] }).session(session ?? null);
  if (match) throw new HoldingOverrideWithoutReasonError();
}

function assertDocumentKeepsHoldReason(document: unknown): void {
  if (!document || typeof document !== 'object') return;
  if (isHoldWithoutRecordedReason(document as Record<string, unknown>)) {
    throw new HoldingOverrideWithoutReasonError();
  }
}

interface GuardedDocument {
  isNew: boolean;
  isModified(path: string): boolean;
  get(path: string): unknown;
}

type BulkWriteOperation = Record<
  string,
  { filter?: Record<string, unknown>; update?: unknown; replacement?: unknown; document?: unknown }
>;

const UPDATE_QUERY_WRITES = ['updateOne', 'updateMany', 'findOneAndUpdate'] as const;
const REPLACE_QUERY_WRITES = ['replaceOne', 'findOneAndReplace'] as const;

// A raw `collection` handle bypasses this, so the gate also counts any hold it finds without a reason.
export function registerHoldOverrideReasonGuard(schema: mongoose.Schema): void {
  for (const operation of UPDATE_QUERY_WRITES) {
    schema.pre(operation, async function guardUpdate(this: mongoose.Query<unknown, unknown>) {
      await enforceHoldReasonCheck(
        this.model as unknown as ExistsModel,
        this.getFilter() as Record<string, unknown>,
        checkUpdateKeepsHoldReason(this.getUpdate()),
        this.getOptions().session,
      );
    });
  }
  for (const operation of REPLACE_QUERY_WRITES) {
    schema.pre(operation, async function guardReplace(this: mongoose.Query<unknown, unknown>) {
      await enforceHoldReasonCheck(
        this.model as unknown as ExistsModel,
        this.getFilter() as Record<string, unknown>,
        checkReplacementKeepsHoldReason(this.getUpdate()),
        this.getOptions().session,
      );
    });
  }
  schema.pre('save', function guardSave(this: GuardedDocument) {
    if (!this.isNew && !this.isModified(TIER_FIELD) && !this.isModified(REASON_FIELD)) return;
    assertDocumentKeepsHoldReason({
      [TIER_FIELD]: this.get(TIER_FIELD),
      [REASON_FIELD]: this.get(REASON_FIELD),
    });
  });
  schema.pre('insertMany', function guardInsertMany(documents: unknown) {
    for (const document of Array.isArray(documents) ? documents : [documents]) {
      assertDocumentKeepsHoldReason(document);
    }
  });
  schema.pre('bulkWrite', async function guardBulkWrite(this: unknown, operations: unknown) {
    if (!Array.isArray(operations)) return;
    for (const operation of operations as BulkWriteOperation[]) {
      for (const [kind, body] of Object.entries(operation ?? {})) {
        if (!body || typeof body !== 'object') continue;
        if (kind === 'insertOne') assertDocumentKeepsHoldReason(body.document);
        else if (kind === 'replaceOne') {
          await enforceHoldReasonCheck(
            this as ExistsModel,
            body.filter ?? {},
            checkReplacementKeepsHoldReason(body.replacement),
            null,
          );
        } else if (kind === 'updateOne' || kind === 'updateMany') {
          await enforceHoldReasonCheck(
            this as ExistsModel,
            body.filter ?? {},
            checkUpdateKeepsHoldReason(body.update),
            null,
          );
        }
      }
    }
  });
}
