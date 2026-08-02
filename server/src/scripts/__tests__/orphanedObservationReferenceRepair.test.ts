import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDirectReferenceAggregationPipeline,
  buildOrphanReferenceArtifact,
  buildOrphanReferenceDecisionTemplate,
  buildOrphanReferenceOwnerFingerprint,
  buildProvenanceReferenceAggregationPipeline,
  classifyOrphanReference,
  validateOrphanReferenceArtifact,
  validateOrphanReferenceDecisions,
  type OrphanReferenceOccurrence,
} from '../orphanedObservationReferenceRepairCore';
import {
  currentReferenceValue,
  orphanReferenceRemovalUpdate,
  parseRepairOrphanedObservationReferencesArgs,
  referenceMatchPath,
  updatePathFor,
  writePrivateJson,
} from '../repairOrphanedObservationReferences';

const temporaryPaths: string[] = [];

afterEach(() => {
  delete process.env.ALLOW_NON_PROD_SCRAPER_WRITES;
  for (const file of temporaryPaths.splice(0)) {
    fs.rmSync(file, { force: true });
  }
});

function occurrence(overrides: Partial<OrphanReferenceOccurrence> = {}): OrphanReferenceOccurrence {
  return {
    ownerCollection: 'research_entities',
    ownerId: '111111111111111111111111',
    field: 'fieldProvenance',
    referenceKey: 'description',
    missingObservationId: '222222222222222222222222',
    activity: 'active',
    ownerFingerprint: 'owner-fingerprint',
    provenance: {
      sourceName: 'official-profile',
      sourceUrl: 'https://example.yale.edu/profile',
    },
    ...overrides,
  };
}

describe('orphaned Observation reference repair core', () => {
  it('builds bounded direct and provenance orphan lookup pipelines', () => {
    const direct = buildDirectReferenceAggregationPipeline(
      { collection: 'entry_pathways', field: 'sourceEvidenceIds' },
      25,
    );
    const provenance = buildProvenanceReferenceAggregationPipeline(
      { collection: 'research_entities', field: 'fieldProvenance', kind: 'provenance-map' },
      10,
    );

    expect(direct).toContainEqual({ $limit: 25 });
    expect(direct).toContainEqual({ $match: { '__observation.0': { $exists: false } } });
    expect(provenance).toContainEqual({ $limit: 10 });
    expect(provenance).toContainEqual({
      $match: { '__provenance.v.observationId': { $type: 'objectId' } },
    });
  });

  it('allows a provenance relink only for one exact subject, field, source, and value match', () => {
    const owner = {
      _id: new mongoose.Types.ObjectId('111111111111111111111111'),
      slug: 'synthetic-home',
      description: 'Synthetic research description.',
    };
    const classified = classifyOrphanReference({
      occurrence: occurrence(),
      owner,
      ownerFieldValue: owner.description,
      dbFingerprint: 'development-target',
      candidates: [
        {
          id: '333333333333333333333333',
          entityType: 'researchEntity',
          entityId: '111111111111111111111111',
          field: 'description',
          value: 'Synthetic research description.',
          sourceName: 'official-profile',
          sourceUrl: 'https://example.yale.edu/profile/',
        },
      ],
    });

    expect(classified).toMatchObject({
      recovery: 'deterministic_relink',
      replacementObservationId: '333333333333333333333333',
      recommendedDecision: 'relink',
      candidateCount: 1,
    });
  });

  it('routes ambiguous active provenance to review without selecting a replacement', () => {
    const owner = {
      _id: new mongoose.Types.ObjectId('111111111111111111111111'),
      slug: 'synthetic-home',
      description: 'Synthetic research description.',
    };
    const candidate = {
      entityType: 'researchEntity',
      entityId: '111111111111111111111111',
      field: 'description',
      value: owner.description,
      sourceName: 'official-profile',
      sourceUrl: 'https://example.yale.edu/profile',
    };
    const classified = classifyOrphanReference({
      occurrence: occurrence(),
      owner,
      ownerFieldValue: owner.description,
      dbFingerprint: 'development-target',
      candidates: [
        { ...candidate, id: '333333333333333333333333' },
        { ...candidate, id: '444444444444444444444444' },
      ],
    });

    expect(classified).toMatchObject({
      recovery: 'review_required',
      recommendedDecision: 'defer_review',
      candidateCount: 2,
    });
    expect(classified.replacementObservationId).toBeUndefined();
  });

  it('preserves archived records and records unrecoverable evidence loss', () => {
    const classified = classifyOrphanReference({
      occurrence: occurrence({
        ownerCollection: 'entry_pathways',
        field: 'sourceEvidenceIds',
        referenceKey: undefined,
        activity: 'archived',
        researchEntityId: '555555555555555555555555',
      }),
      owner: {},
      candidates: [],
      currentMaterializationEvidenceIds: ['666666666666666666666666'],
      dbFingerprint: 'development-target',
    });

    expect(classified).toMatchObject({
      recovery: 'record_archived_loss',
      recommendedDecision: 'record_loss',
    });
  });

  it('uses current materializer evidence instead of guessing a direct access relink', () => {
    const classified = classifyOrphanReference({
      occurrence: occurrence({
        ownerCollection: 'access_signals',
        field: 'sourceEvidenceId',
        referenceKey: undefined,
        researchEntityId: '555555555555555555555555',
        ownerDerivationKey: 'signal:CURRENT_UNDERGRADS',
      }),
      owner: {},
      candidates: [],
      currentMaterializationEvidenceIds: ['666666666666666666666666'],
      dbFingerprint: 'development-target',
    });

    expect(classified).toMatchObject({
      recovery: 'rematerialize_access',
      rematerializationMode: 'refresh_owner',
      recommendedDecision: 'rematerialize',
      candidateCount: 1,
    });
  });

  it('distinguishes a canonical semantic replacement from an in-place refresh', () => {
    const classified = classifyOrphanReference({
      occurrence: occurrence({
        ownerCollection: 'contact_routes',
        field: 'sourceEvidenceId',
        referenceKey: undefined,
        researchEntityId: '555555555555555555555555',
        ownerDerivationKey: 'route:FACULTY_PI:OFFICIAL_PROFILE:synthetic',
      }),
      owner: {},
      candidates: [],
      currentMaterializationEvidenceIds: ['666666666666666666666666'],
      materializationReplacesOwner: true,
      dbFingerprint: 'development-target',
    });

    expect(classified).toMatchObject({
      recovery: 'rematerialize_access',
      rematerializationMode: 'replace_legacy_owner',
      recommendedDecision: 'rematerialize',
    });
  });

  it('binds reviewed decisions to a fresh untampered Development artifact', () => {
    const row = classifyOrphanReference({
      occurrence: occurrence({
        ownerCollection: 'access_signals',
        field: 'sourceEvidenceId',
        referenceKey: undefined,
        researchEntityId: '555555555555555555555555',
      }),
      owner: {},
      candidates: [],
      currentMaterializationEvidenceIds: ['666666666666666666666666'],
      dbFingerprint: 'development-target',
    });
    const generatedAt = new Date('2026-08-02T12:00:00.000Z');
    const artifact = buildOrphanReferenceArtifact({
      generatedAt,
      dbFingerprint: 'development-target',
      limitPerReference: 100,
      rows: [row],
    });
    validateOrphanReferenceArtifact(
      artifact,
      'development-target',
      new Date('2026-08-02T13:00:00.000Z'),
    );
    const template = buildOrphanReferenceDecisionTemplate(artifact);
    template.decisions[0].reviewedBy = 'synthetic-reviewer';
    expect(
      validateOrphanReferenceDecisions({ artifact, envelope: template, maxApply: 1 }),
    ).toHaveLength(1);

    expect(() =>
      validateOrphanReferenceArtifact(
        { ...artifact, limitPerReference: 101 },
        'development-target',
        new Date('2026-08-02T13:00:00.000Z'),
      ),
    ).toThrow(/hash does not match/);
    expect(() =>
      validateOrphanReferenceArtifact(
        artifact,
        'different-target',
        new Date('2026-08-02T13:00:00.000Z'),
      ),
    ).toThrow(/database target does not match/);
    expect(() =>
      validateOrphanReferenceDecisions({
        artifact,
        envelope: { artifactHash: artifact.artifactHash } as never,
        maxApply: 1,
      }),
    ).toThrow(/decisions array/);
  });

  it('rejects a reviewer action that exceeds the classifier recovery contract', () => {
    const row = classifyOrphanReference({
      occurrence: occurrence(),
      owner: { description: 'Synthetic research description.' },
      ownerFieldValue: 'Synthetic research description.',
      candidates: [],
      dbFingerprint: 'development-target',
    });
    const artifact = buildOrphanReferenceArtifact({
      generatedAt: new Date('2026-08-02T12:00:00.000Z'),
      dbFingerprint: 'development-target',
      limitPerReference: 100,
      rows: [row],
    });
    expect(() =>
      validateOrphanReferenceDecisions({
        artifact,
        maxApply: 1,
        envelope: {
          artifactHash: artifact.artifactHash,
          decisions: [{ handle: row.handle, decision: 'relink', reviewedBy: 'synthetic-reviewer' }],
        },
      }),
    ).toThrow(/not allowed/);
  });
});

describe('orphaned Observation reference repair CLI', () => {
  it('parses a bounded dry-run with private outputs', () => {
    expect(
      parseRepairOrphanedObservationReferencesArgs([
        '--limit-per-reference=50',
        '--max-apply=5',
        '--private-output=/tmp/ylabs-orphan-classifier.json',
        '--decision-template-output=/tmp/ylabs-orphan-decisions.json',
      ]),
    ).toEqual({
      execute: false,
      confirm: false,
      limitPerReference: 50,
      maxApply: 5,
      privateOutput: '/tmp/ylabs-orphan-classifier.json',
      decisionTemplateOutput: '/tmp/ylabs-orphan-decisions.json',
    });
  });

  it('requires reviewed artifacts, confirmation, and the non-production write guard', () => {
    expect(() =>
      parseRepairOrphanedObservationReferencesArgs([
        '--execute',
        '--private-output=/tmp/ylabs-orphan-apply.json',
      ]),
    ).toThrow(/requires --apply-from and --decisions/);

    process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
    expect(() =>
      parseRepairOrphanedObservationReferencesArgs([
        '--execute',
        '--apply-from=/tmp/ylabs-orphan-classifier.json',
        '--decisions=/tmp/ylabs-orphan-decisions.json',
        '--private-output=/tmp/ylabs-orphan-apply.json',
      ]),
    ).toThrow(/requires --confirm-development-orphan-reference-repair/);
  });

  it('writes private artifacts with owner-only permissions', () => {
    const output = path.join(os.tmpdir(), `ylabs-orphan-test-${process.pid}.json`);
    temporaryPaths.push(output);
    writePrivateJson({ synthetic: true }, output, '--private-output');
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  it('fingerprints the complete owner snapshot for preflight changes', () => {
    expect(
      buildOrphanReferenceOwnerFingerprint({
        owner: { _id: '111111111111111111111111', updatedAt: '2026-08-02T12:00:00Z' },
        field: 'sourceEvidenceId',
      }),
    ).not.toBe(
      buildOrphanReferenceOwnerFingerprint({
        owner: { _id: '111111111111111111111111', updatedAt: '2026-08-02T12:01:00Z' },
        field: 'sourceEvidenceId',
      }),
    );
  });

  it('removes only the reviewed dangling reference path', () => {
    const arrayClassification = {
      ...occurrence({
        ownerCollection: 'entry_pathways',
        field: 'sourceEvidenceIds',
        referenceKey: undefined,
        arrayIndex: 2,
      }),
      handle: 'synthetic-handle',
      recovery: 'record_archived_loss' as const,
      reason: 'synthetic',
      candidateCount: 0,
      recommendedDecision: 'record_loss' as const,
    };
    expect(updatePathFor(arrayClassification)).toBe('sourceEvidenceIds.2');
    expect(referenceMatchPath(arrayClassification)).toBe('sourceEvidenceIds');
    expect(orphanReferenceRemovalUpdate(arrayClassification)).toEqual({
      $pull: {
        sourceEvidenceIds: new mongoose.Types.ObjectId('222222222222222222222222'),
      },
    });

    const provenanceClassification = {
      ...arrayClassification,
      ownerCollection: 'research_entities',
      field: 'fieldProvenance',
      referenceKey: 'description',
      arrayIndex: undefined,
    };
    expect(updatePathFor(provenanceClassification)).toBe(
      'fieldProvenance.description.observationId',
    );
    expect(orphanReferenceRemovalUpdate(provenanceClassification)).toEqual({
      $unset: { 'fieldProvenance.description.observationId': '' },
    });
  });

  it('tracks a reviewed array orphan by value after earlier pulls shift indices', () => {
    const classification = {
      ...occurrence({
        ownerCollection: 'entry_pathways',
        field: 'sourceEvidenceIds',
        referenceKey: undefined,
        arrayIndex: 2,
      }),
      handle: 'synthetic-handle',
      recovery: 'record_archived_loss' as const,
      reason: 'synthetic',
      candidateCount: 0,
      recommendedDecision: 'record_loss' as const,
    };
    expect(
      currentReferenceValue(
        {
          sourceEvidenceIds: [
            new mongoose.Types.ObjectId('222222222222222222222222'),
            new mongoose.Types.ObjectId('333333333333333333333333'),
          ],
        },
        classification,
      ),
    ).toBe('222222222222222222222222');
    expect(
      currentReferenceValue(
        {
          sourceEvidenceIds: [new mongoose.Types.ObjectId('333333333333333333333333')],
        },
        classification,
      ),
    ).toBeUndefined();
  });
});
