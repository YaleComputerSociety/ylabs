import mongoose from 'mongoose';

export const MAX_MATERIALIZED_PROVENANCE_EVIDENCE_CLAIMS = 100;
export const MAX_MATERIALIZER_IDENTIFIER_LENGTH = 120;

const MATERIALIZER_IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export interface MaterializedProvenance {
  evidenceClaimIds: mongoose.Types.ObjectId[];
  materializer: string;
  materializerVersion: number;
  computedAt: Date;
}

export function normalizeMaterializerIdentifier(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function isNormalizedMaterializerIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MATERIALIZER_IDENTIFIER_LENGTH &&
    value === normalizeMaterializerIdentifier(value) &&
    MATERIALIZER_IDENTIFIER_PATTERN.test(value)
  );
}

function hasBoundedUniqueEvidenceClaimIds(values: readonly mongoose.Types.ObjectId[]): boolean {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= MAX_MATERIALIZED_PROVENANCE_EVIDENCE_CLAIMS &&
    values.every((value) => value instanceof mongoose.Types.ObjectId) &&
    new Set(values.map((value) => value.toHexString())).size === values.length
  );
}

export const materializedProvenanceSchema = new mongoose.Schema<MaterializedProvenance>(
  {
    evidenceClaimIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'EvidenceClaim',
        },
      ],
      required: true,
      validate: {
        validator: hasBoundedUniqueEvidenceClaimIds,
        message: `evidenceClaimIds must contain 1 to ${MAX_MATERIALIZED_PROVENANCE_EVIDENCE_CLAIMS} unique EvidenceClaim ids.`,
      },
    },
    materializer: {
      type: String,
      required: true,
      set: normalizeMaterializerIdentifier,
      maxlength: MAX_MATERIALIZER_IDENTIFIER_LENGTH,
      validate: {
        validator: isNormalizedMaterializerIdentifier,
        message:
          'materializer must be a normalized lowercase identifier using dots, underscores, or hyphens as separators.',
      },
    },
    materializerVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'materializerVersion must be a positive safe integer.',
      },
    },
    computedAt: {
      type: Date,
      required: true,
      validate: {
        validator: (value: Date) => value instanceof Date && !Number.isNaN(value.getTime()),
        message: 'computedAt must be a valid date.',
      },
    },
  },
  {
    _id: false,
  },
);
