import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  MAX_MATERIALIZED_PROVENANCE_EVIDENCE_CLAIMS,
  MAX_MATERIALIZER_IDENTIFIER_LENGTH,
  isNormalizedMaterializerIdentifier,
  materializedProvenanceSchema,
  normalizeMaterializerIdentifier,
} from '../materializedProvenance';
import { materializedProvenanceSchema as barrelMaterializedProvenanceSchema } from '../index';

const fixtureSchema = new mongoose.Schema({
  provenance: {
    type: materializedProvenanceSchema,
    required: true,
  },
});

const MaterializedProvenanceFixture =
  mongoose.models.MaterializedProvenanceFixture ||
  mongoose.model(
    'MaterializedProvenanceFixture',
    fixtureSchema,
    'materialized_provenance_fixtures',
  );

const objectId = () => new mongoose.Types.ObjectId();

const validProvenance = () => ({
  evidenceClaimIds: [objectId()],
  materializer: 'access-materializer',
  materializerVersion: 1,
  computedAt: new Date('2026-07-29T12:00:00.000Z'),
});

describe('MaterializedProvenance embedded contract', () => {
  it('exports one unattached embedded schema without its own document identity', () => {
    const fixture = new MaterializedProvenanceFixture({
      provenance: validProvenance(),
    });

    expect(barrelMaterializedProvenanceSchema).toBe(materializedProvenanceSchema);
    expect(materializedProvenanceSchema.path('_id')).toBeUndefined();
    expect(mongoose.models.MaterializedProvenance).toBeUndefined();
    expect(fixture.provenance._id).toBeUndefined();
    expect(fixture.validateSync()).toBeUndefined();
  });

  it('requires a bounded, unique, nonempty EvidenceClaim reference set', () => {
    const claimId = objectId();
    const missing = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        evidenceClaimIds: [],
      },
    });
    const duplicates = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        evidenceClaimIds: [claimId, claimId],
      },
    });
    const unbounded = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        evidenceClaimIds: Array.from(
          { length: MAX_MATERIALIZED_PROVENANCE_EVIDENCE_CLAIMS + 1 },
          objectId,
        ),
      },
    });
    const malformed = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        evidenceClaimIds: ['not-an-object-id'],
      },
    });

    expect(missing.validateSync()?.errors['provenance.evidenceClaimIds']).toBeTruthy();
    expect(duplicates.validateSync()?.errors['provenance.evidenceClaimIds']).toBeTruthy();
    expect(unbounded.validateSync()?.errors['provenance.evidenceClaimIds']).toBeTruthy();
    expect(malformed.validateSync()?.errors['provenance.evidenceClaimIds.0']).toBeTruthy();
    const claimIdsPath = materializedProvenanceSchema.path('evidenceClaimIds') as unknown as {
      caster?: { options?: { ref?: string } };
    };
    expect(claimIdsPath.caster?.options?.ref).toBe('EvidenceClaim');
  });

  it('normalizes and validates a bounded stable materializer identifier', () => {
    const normalized = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        materializer: ' Access-Materializer.V2 ',
      },
    });
    const unsafe = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        materializer: 'access materializer/v2',
      },
    });
    const missing = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        materializer: '',
      },
    });
    const unbounded = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        materializer: `m${'a'.repeat(MAX_MATERIALIZER_IDENTIFIER_LENGTH)}`,
      },
    });

    expect(normalizeMaterializerIdentifier(' Access-Materializer.V2 ')).toBe(
      'access-materializer.v2',
    );
    expect(isNormalizedMaterializerIdentifier('access-materializer.v2')).toBe(true);
    expect(normalized.provenance.materializer).toBe('access-materializer.v2');
    expect(normalized.validateSync()).toBeUndefined();
    expect(unsafe.validateSync()?.errors['provenance.materializer']).toBeTruthy();
    expect(missing.validateSync()?.errors['provenance.materializer']).toBeTruthy();
    expect(unbounded.validateSync()?.errors['provenance.materializer']).toBeTruthy();
  });

  it('requires a positive safe integer materializer version', () => {
    for (const materializerVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      const fixture = new MaterializedProvenanceFixture({
        provenance: {
          ...validProvenance(),
          materializerVersion,
        },
      });

      expect(fixture.validateSync()?.errors['provenance.materializerVersion']).toBeTruthy();
    }
  });

  it('requires a valid computed timestamp', () => {
    const missing = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        computedAt: undefined,
      },
    });
    const invalid = new MaterializedProvenanceFixture({
      provenance: {
        ...validProvenance(),
        computedAt: 'not-a-date',
      },
    });

    expect(missing.validateSync()?.errors['provenance.computedAt']).toBeTruthy();
    expect(invalid.validateSync()?.errors['provenance.computedAt']).toBeTruthy();
  });
});
