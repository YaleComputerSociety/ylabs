import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  EvidenceClaim,
  MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH,
  MAX_EVIDENCE_CLAIM_VALUE_COLLECTION_ITEMS,
  MAX_EVIDENCE_CLAIM_VALUE_DEPTH,
  MAX_EVIDENCE_CLAIM_VALUE_STRING_LENGTH,
  evidenceClaimSchema,
} from '../evidenceClaim';
import {
  EVIDENCE_PREDICATE_REGISTRY_VERSION,
  evidenceClaimPredicates,
  evidencePredicateRegistry,
  evidencePredicateSupportsSubject,
} from '../evidencePredicateRegistry';
import {
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  RESEARCH_PLAN_SCHEMA_VERSION,
  ResearchPlan,
  researchPlanSchema,
} from '../researchPlan';
import {
  MAX_REVIEW_DECISION_EVIDENCE_CLAIMS,
  MAX_REVIEW_DECISION_FIELD_PATHS,
  MAX_REVIEW_DECISION_FIELD_PATH_LENGTH,
  MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH,
  MAX_REVIEW_DECISION_RATIONALE_LENGTH,
  REVIEW_DECISION_SCHEMA_VERSION,
  ReviewDecision,
  reviewDecisionSchema,
} from '../reviewDecision';
import { Source } from '../source';
import {
  MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH,
  MAX_SOURCE_DOCUMENT_METADATA_TEXT_LENGTH,
  MAX_SOURCE_DOCUMENT_POINTER_LENGTH,
  MAX_SOURCE_DOCUMENT_REDIRECTS,
  SOURCE_DOCUMENT_SCHEMA_VERSION,
  SourceDocument,
  normalizeSourceDocumentKey,
  sourceDocumentSchema,
} from '../sourceDocument';
import { StudentEngagementEvent } from '../studentEngagementEvent';
import {
  Source as BarrelSource,
  StudentEngagementEvent as BarrelStudentEngagementEvent,
} from '../index';

const objectId = () => new mongoose.Types.ObjectId();
const contentHash = 'a'.repeat(64);

const validResearchPlan = () => ({
  accountId: objectId(),
  target: {
    kind: 'RESEARCH_ENTITY',
    id: objectId(),
  },
});

const validSourceDocument = () => ({
  sourceId: objectId(),
  documentKey: 'official-profile:ada-lovelace',
  canonicalUrl: 'https://example.yale.edu/profile/ada-lovelace',
  retrievedAt: new Date('2026-07-25T12:00:00.000Z'),
  contentHash,
});

const validEvidenceClaim = () => ({
  subject: {
    kind: 'PERSON',
    id: objectId(),
  },
  predicate: 'PERSON_HAS_ORCID',
  value: '0000-0000-0000-0000',
  sourceDocumentId: objectId(),
  observedAt: new Date('2026-07-25T12:00:00.000Z'),
  confidence: 0.95,
});

const validReviewDecision = () => ({
  target: {
    kind: 'EVIDENCE_CLAIM',
    id: objectId(),
  },
  decisionType: 'APPROVE',
  rationale: 'The source and subject identity agree.',
  reviewerAccountId: objectId(),
});

const indexKeys = (schema: mongoose.Schema): Record<string, number>[] =>
  schema.indexes().map(([keys]) => keys as Record<string, number>);

describe('canonical evidence, planning, and review models', () => {
  it.each([
    [ResearchPlan, 'ResearchPlan', 'research_plans'],
    [SourceDocument, 'SourceDocument', 'source_documents'],
    [EvidenceClaim, 'EvidenceClaim', 'evidence_claims'],
    [ReviewDecision, 'ReviewDecision', 'review_decisions'],
  ])('registers %s with an explicit physical collection', (model, modelName, collection) => {
    expect(model.modelName).toBe(modelName);
    expect(model.collection.name).toBe(collection);
    expect(mongoose.models[modelName]).toBe(model);
  });

  it('keeps schema versions collection-specific and rejects unsupported versions', () => {
    const fixtures = [
      [ResearchPlan, validResearchPlan(), RESEARCH_PLAN_SCHEMA_VERSION],
      [SourceDocument, validSourceDocument(), SOURCE_DOCUMENT_SCHEMA_VERSION],
      [EvidenceClaim, validEvidenceClaim(), EVIDENCE_CLAIM_SCHEMA_VERSION],
      [ReviewDecision, validReviewDecision(), REVIEW_DECISION_SCHEMA_VERSION],
    ] as const;

    for (const [Model, fixture, contract] of fixtures) {
      const current = new Model(fixture);
      expect(current.schemaVersion).toBe(contract.currentVersion);
      expect(current.validateSync()).toBeUndefined();

      const unsupported = new Model({ ...fixture, schemaVersion: 2 });
      expect(unsupported.validateSync()?.errors.schemaVersion).toBeTruthy();
    }
  });

  it('registers barrel exports without duplicating existing Source or engagement models', () => {
    expect(BarrelSource).toBe(Source);
    expect(BarrelStudentEngagementEvent).toBe(StudentEngagementEvent);
    expect(Source.collection.name).toBe('sources');
    expect(StudentEngagementEvent.collection.name).toBe('student_engagement_events');
    expect(mongoose.modelNames().filter((name) => name === 'Source')).toHaveLength(1);
    expect(mongoose.modelNames().filter((name) => name === 'StudentEngagementEvent')).toHaveLength(
      1,
    );
  });

  describe('ResearchPlan', () => {
    it('requires account ownership and a typed target', () => {
      const missingAccount = new ResearchPlan({
        target: validResearchPlan().target,
      });
      const missingTarget = new ResearchPlan({
        accountId: objectId(),
      });
      const invalidTargetKind = new ResearchPlan({
        ...validResearchPlan(),
        target: { kind: 'PAPER', id: objectId() },
      });

      expect(missingAccount.validateSync()?.errors.accountId).toBeTruthy();
      expect(missingTarget.validateSync()?.errors.target).toBeTruthy();
      expect(invalidTargetKind.validateSync()?.errors['target.kind']).toBeTruthy();
      expect(researchPlanSchema.path('accountId').options.ref).toBe('Account');
    });

    it('keeps private plan content excluded and export opt-in by default', () => {
      const plan = new ResearchPlan({
        ...validResearchPlan(),
        privateNotes: 'Do not export this note.',
        checklist: [{ label: 'Read the official project page.' }],
      });

      expect(plan.exportPreferences).toMatchObject({
        includePrivateNotes: false,
        includeChecklist: false,
        includeDeadlines: false,
      });
      expect(researchPlanSchema.path('privateNotes').options.select).toBe(false);
      expect(researchPlanSchema.path('checklist').options.select).toBe(false);
      expect(researchPlanSchema.path('deadlines').options.select).toBe(false);
    });

    it('bounds private notes and embedded checklist items', () => {
      const longNotes = new ResearchPlan({
        ...validResearchPlan(),
        privateNotes: 'n'.repeat(MAX_RESEARCH_PLAN_NOTES_LENGTH + 1),
      });
      const largeChecklist = new ResearchPlan({
        ...validResearchPlan(),
        checklist: Array.from({ length: MAX_RESEARCH_PLAN_CHECKLIST_ITEMS + 1 }, (_, index) => ({
          label: `Item ${index}`,
        })),
      });
      const longChecklistLabel = new ResearchPlan({
        ...validResearchPlan(),
        checklist: [
          {
            label: 'l'.repeat(MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH + 1),
          },
        ],
      });
      const tooManyDeadlines = new ResearchPlan({
        ...validResearchPlan(),
        deadlines: Array.from({ length: MAX_RESEARCH_PLAN_DEADLINES + 1 }, (_, index) => ({
          label: `Deadline ${index}`,
          dueAt: new Date('2026-08-01T12:00:00.000Z'),
        })),
      });

      expect(longNotes.validateSync()?.errors.privateNotes).toBeTruthy();
      expect(largeChecklist.validateSync()?.errors.checklist).toBeTruthy();
      expect(longChecklistLabel.validateSync()?.errors['checklist.0.label']).toBeTruthy();
      expect(tooManyDeadlines.validateSync()?.errors.deadlines).toBeTruthy();
    });

    it('keeps checklist completion and completion timestamps coherent', () => {
      const completedWithoutTimestamp = new ResearchPlan({
        ...validResearchPlan(),
        checklist: [{ label: 'Review the source.', completed: true }],
      });
      const incompleteWithTimestamp = new ResearchPlan({
        ...validResearchPlan(),
        checklist: [
          {
            label: 'Review the source.',
            completed: false,
            completedAt: new Date('2026-07-25T12:00:00.000Z'),
          },
        ],
      });
      const completed = new ResearchPlan({
        ...validResearchPlan(),
        checklist: [
          {
            label: 'Review the source.',
            completed: true,
            completedAt: new Date('2026-07-25T12:00:00.000Z'),
          },
        ],
      });

      expect(
        completedWithoutTimestamp.validateSync()?.errors['checklist.0.completedAt'],
      ).toBeTruthy();
      expect(incompleteWithTimestamp.validateSync()?.errors['checklist.0.completed']).toBeTruthy();
      expect(completed.validateSync()).toBeUndefined();
    });

    it('declares one plan per account and typed target', () => {
      expect(researchPlanSchema.indexes()).toContainEqual([
        { accountId: 1, 'target.kind': 1, 'target.id': 1 },
        { unique: true, background: true },
      ]);
    });
  });

  describe('SourceDocument', () => {
    it('requires a source-scoped stable identity and a URL or external resource key', () => {
      const missingResource = new SourceDocument({
        ...validSourceDocument(),
        canonicalUrl: undefined,
        externalResourceKey: undefined,
      });
      const externalResource = new SourceDocument({
        ...validSourceDocument(),
        canonicalUrl: undefined,
        externalResourceKey: 'works/W123',
      });
      const missingDocumentKey = new SourceDocument({
        ...validSourceDocument(),
        documentKey: undefined,
      });

      expect(missingResource.validateSync()?.errors.canonicalUrl).toBeTruthy();
      expect(missingResource.validateSync()?.errors.externalResourceKey).toBeTruthy();
      expect(externalResource.validateSync()).toBeUndefined();
      expect(missingDocumentKey.validateSync()?.errors.documentKey).toBeTruthy();
      expect(sourceDocumentSchema.path('sourceId').options.ref).toBe('Source');
      expect(normalizeSourceDocumentKey(' Official-Profile:ADA-Lovelace ')).toBe(
        'official-profile:ada-lovelace',
      );
    });

    it('protects snapshot pointers and metadata without embedding raw payloads', () => {
      expect(sourceDocumentSchema.path('snapshotPointer').options.select).toBe(false);
      expect(sourceDocumentSchema.path('metadata').options.select).toBe(false);
      expect(sourceDocumentSchema.path('content')).toBeUndefined();
      expect(sourceDocumentSchema.path('rawContent')).toBeUndefined();
      expect(sourceDocumentSchema.path('snapshot')).toBeUndefined();
    });

    it('bounds protected source pointers, resource keys, and metadata text', () => {
      const longPointer = new SourceDocument({
        ...validSourceDocument(),
        snapshotPointer: 'p'.repeat(MAX_SOURCE_DOCUMENT_POINTER_LENGTH + 1),
      });
      const longExternalKey = new SourceDocument({
        ...validSourceDocument(),
        canonicalUrl: undefined,
        externalResourceKey: 'e'.repeat(MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH + 1),
      });
      const longMetadata = new SourceDocument({
        ...validSourceDocument(),
        metadata: {
          title: 't'.repeat(MAX_SOURCE_DOCUMENT_METADATA_TEXT_LENGTH + 1),
        },
      });

      expect(longPointer.validateSync()?.errors.snapshotPointer).toBeTruthy();
      expect(longExternalKey.validateSync()?.errors.externalResourceKey).toBeTruthy();
      expect(longMetadata.validateSync()?.errors['metadata.title']).toBeTruthy();
    });

    it('bounds redirects and rejects unsafe source URL shapes', () => {
      const tooManyRedirects = new SourceDocument({
        ...validSourceDocument(),
        redirectChain: Array.from(
          { length: MAX_SOURCE_DOCUMENT_REDIRECTS + 1 },
          (_, index) => `https://example.yale.edu/redirect/${index}`,
        ),
      });
      const nonHttpUrl = new SourceDocument({
        ...validSourceDocument(),
        canonicalUrl: 'file:///tmp/source.html',
      });
      const credentialedUrl = new SourceDocument({
        ...validSourceDocument(),
        canonicalUrl: 'https://student:secret@example.yale.edu/profile',
      });
      const malformedDocumentKey = new SourceDocument({
        ...validSourceDocument(),
        documentKey: 'unsafe key with spaces',
      });
      const normalizedDocumentKey = new SourceDocument({
        ...validSourceDocument(),
        documentKey: ' Official-Profile:ADA-Lovelace ',
      });

      expect(tooManyRedirects.validateSync()?.errors.redirectChain).toBeTruthy();
      expect(nonHttpUrl.validateSync()?.errors.canonicalUrl).toBeTruthy();
      expect(credentialedUrl.validateSync()?.errors.canonicalUrl).toBeTruthy();
      expect(malformedDocumentKey.validateSync()?.errors.documentKey).toBeTruthy();
      expect(normalizedDocumentKey.documentKey).toBe('official-profile:ada-lovelace');
      expect(normalizedDocumentKey.validateSync()).toBeUndefined();
    });

    it('deduplicates identical source resource versions without a TTL index', () => {
      expect(sourceDocumentSchema.indexes()).toContainEqual([
        { sourceId: 1, documentKey: 1, contentHash: 1 },
        { unique: true, background: true },
      ]);
      for (const [, options] of sourceDocumentSchema.indexes()) {
        expect(options).not.toHaveProperty('expireAfterSeconds');
      }
    });
  });

  describe('EvidenceClaim', () => {
    it('publishes the exact versioned predicate registry from the contract', () => {
      expect(EVIDENCE_PREDICATE_REGISTRY_VERSION).toBe(1);
      expect(evidenceClaimPredicates).toEqual([
        'PERSON_HAS_OFFICIAL_PROFILE',
        'PERSON_HAS_ORCID',
        'PERSON_LEADS_ENTITY',
        'ENTITY_HAS_DESCRIPTION',
        'ENTITY_USES_METHOD',
        'UNDERGRAD_PARTICIPATION_OBSERVED',
        'OFFICIAL_APPLICATION_EXISTS',
        'OPPORTUNITY_HAS_DEADLINE',
        'DIRECT_CONTACT_NOT_PERMITTED',
      ]);
      expect(Object.isFrozen(evidencePredicateRegistry)).toBe(true);
      expect(evidencePredicateSupportsSubject('PERSON_HAS_ORCID', 'PERSON')).toBe(true);
      expect(evidencePredicateSupportsSubject('PERSON_HAS_ORCID', 'RESEARCH_ENTITY')).toBe(false);
    });

    it('requires a canonical id or stable key for the subject', () => {
      const noIdentity = new EvidenceClaim({
        ...validEvidenceClaim(),
        subject: { kind: 'PERSON' },
      });
      const stableKey = new EvidenceClaim({
        ...validEvidenceClaim(),
        subject: { kind: 'PERSON', key: 'official-profile:ada-lovelace' },
      });

      expect(noIdentity.validateSync()?.errors.subject).toBeTruthy();
      expect(stableKey.validateSync()).toBeUndefined();
    });

    it('rejects unknown predicates and predicates used on unsupported subjects', () => {
      const unknown = new EvidenceClaim({
        ...validEvidenceClaim(),
        predicate: 'PERSON_HAS_PUBLICATIONS',
      });
      const unsupportedSubject = new EvidenceClaim({
        ...validEvidenceClaim(),
        subject: { kind: 'POSTED_OPPORTUNITY', id: objectId() },
        predicate: 'PERSON_HAS_ORCID',
      });
      const unsupportedRegistryVersion = new EvidenceClaim({
        ...validEvidenceClaim(),
        predicateRegistryVersion: 2,
      });

      expect(unknown.validateSync()?.errors.predicate).toBeTruthy();
      expect(unsupportedSubject.validateSync()?.errors.predicate).toBeTruthy();
      expect(
        unsupportedRegistryVersion.validateSync()?.errors.predicateRegistryVersion,
      ).toBeTruthy();
    });

    it('bounds excerpts, strings, arrays, and nested mixed values', () => {
      const longExcerpt = new EvidenceClaim({
        ...validEvidenceClaim(),
        excerpt: 'e'.repeat(MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH + 1),
      });
      const longString = new EvidenceClaim({
        ...validEvidenceClaim(),
        value: 'v'.repeat(MAX_EVIDENCE_CLAIM_VALUE_STRING_LENGTH + 1),
      });
      const largeArray = new EvidenceClaim({
        ...validEvidenceClaim(),
        value: Array.from(
          { length: MAX_EVIDENCE_CLAIM_VALUE_COLLECTION_ITEMS + 1 },
          (_, index) => index,
        ),
      });
      let nested: unknown = 'leaf';
      for (let index = 0; index <= MAX_EVIDENCE_CLAIM_VALUE_DEPTH; index += 1) {
        nested = { child: nested };
      }
      const deepValue = new EvidenceClaim({
        ...validEvidenceClaim(),
        value: nested,
      });

      expect(longExcerpt.validateSync()?.errors.excerpt).toBeTruthy();
      expect(longString.validateSync()?.errors.value).toBeTruthy();
      expect(largeArray.validateSync()?.errors.value).toBeTruthy();
      expect(deepValue.validateSync()?.errors.value).toBeTruthy();
    });

    it('fails closed and requires coherent supersession state', () => {
      const claim = new EvidenceClaim(validEvidenceClaim());
      const missingReplacement = new EvidenceClaim({
        ...validEvidenceClaim(),
        status: 'SUPERSEDED',
      });
      const unexpectedReplacement = new EvidenceClaim({
        ...validEvidenceClaim(),
        status: 'ACTIVE',
        supersededByClaimId: objectId(),
      });
      const validSupersession = new EvidenceClaim({
        ...validEvidenceClaim(),
        status: 'SUPERSEDED',
        supersededByClaimId: objectId(),
      });
      const selfSupersession = new EvidenceClaim({
        ...validEvidenceClaim(),
        status: 'SUPERSEDED',
      });
      selfSupersession.supersededByClaimId = selfSupersession._id;

      expect(claim.sensitivity).toBe('ADMIN_ONLY');
      expect(evidenceClaimSchema.path('value').options.select).toBe(false);
      expect(evidenceClaimSchema.path('excerpt').options.select).toBe(false);
      expect(missingReplacement.validateSync()?.errors.status).toBeTruthy();
      expect(unexpectedReplacement.validateSync()?.errors.status).toBeTruthy();
      expect(selfSupersession.validateSync()?.errors.status).toBeTruthy();
      expect(selfSupersession.validateSync()?.errors.supersededByClaimId).toBeTruthy();
      expect(validSupersession.validateSync()).toBeUndefined();
    });

    it('keeps claim history non-unique', () => {
      for (const [, options] of evidenceClaimSchema.indexes()) {
        expect(options.unique).not.toBe(true);
      }
      expect(indexKeys(evidenceClaimSchema)).toContainEqual({
        sourceDocumentId: 1,
        observedAt: -1,
      });
    });
  });

  describe('ReviewDecision', () => {
    it('requires an account reviewer and protects internal identity and notes', () => {
      const missingReviewer = new ReviewDecision({
        ...validReviewDecision(),
        reviewerAccountId: undefined,
      });

      expect(missingReviewer.validateSync()?.errors.reviewerAccountId).toBeTruthy();
      expect(reviewDecisionSchema.path('reviewerAccountId').options.ref).toBe('Account');
      expect(reviewDecisionSchema.path('reviewerAccountId').options.select).toBe(false);
      expect(reviewDecisionSchema.path('internalNotes').options.select).toBe(false);
    });

    it('requires coherent same-kind replacement targets for merge decisions', () => {
      const missingReplacement = new ReviewDecision({
        ...validReviewDecision(),
        decisionType: 'MERGE',
      });
      const wrongKind = new ReviewDecision({
        ...validReviewDecision(),
        decisionType: 'MERGE',
        replacementTarget: { kind: 'PERSON', id: objectId() },
      });
      const validMerge = new ReviewDecision({
        ...validReviewDecision(),
        decisionType: 'MERGE',
        replacementTarget: { kind: 'EVIDENCE_CLAIM', id: objectId() },
      });
      const unexpectedReplacement = new ReviewDecision({
        ...validReviewDecision(),
        replacementTarget: { kind: 'EVIDENCE_CLAIM', id: objectId() },
      });
      const selfMergeFixture = validReviewDecision();
      const selfMerge = new ReviewDecision({
        ...selfMergeFixture,
        decisionType: 'MERGE',
        replacementTarget: selfMergeFixture.target,
      });

      expect(missingReplacement.validateSync()?.errors.decisionType).toBeTruthy();
      expect(wrongKind.validateSync()?.errors.decisionType).toBeTruthy();
      expect(selfMerge.validateSync()?.errors.decisionType).toBeTruthy();
      expect(validMerge.validateSync()).toBeUndefined();
      expect(unexpectedReplacement.validateSync()?.errors.decisionType).toBeTruthy();
    });

    it('bounds review notes and evidence arrays', () => {
      const longNotes = new ReviewDecision({
        ...validReviewDecision(),
        internalNotes: 'n'.repeat(MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH + 1),
      });
      const tooManyEvidenceClaims = new ReviewDecision({
        ...validReviewDecision(),
        evidenceClaimIds: Array.from({ length: MAX_REVIEW_DECISION_EVIDENCE_CLAIMS + 1 }, objectId),
      });
      const duplicateEvidenceClaimId = objectId();
      const duplicateArrays = new ReviewDecision({
        ...validReviewDecision(),
        fieldPaths: ['status', 'status'],
        evidenceClaimIds: [duplicateEvidenceClaimId, duplicateEvidenceClaimId],
      });
      const longRationale = new ReviewDecision({
        ...validReviewDecision(),
        rationale: 'r'.repeat(MAX_REVIEW_DECISION_RATIONALE_LENGTH + 1),
      });
      const longFieldPath = new ReviewDecision({
        ...validReviewDecision(),
        fieldPaths: [`target.${'f'.repeat(MAX_REVIEW_DECISION_FIELD_PATH_LENGTH + 1)}`],
      });
      const tooManyFieldPaths = new ReviewDecision({
        ...validReviewDecision(),
        fieldPaths: Array.from(
          { length: MAX_REVIEW_DECISION_FIELD_PATHS + 1 },
          (_, index) => `field.${index}`,
        ),
      });

      expect(longNotes.validateSync()?.errors.internalNotes).toBeTruthy();
      expect(longRationale.validateSync()?.errors.rationale).toBeTruthy();
      expect(longFieldPath.validateSync()?.errors['fieldPaths.0']).toBeTruthy();
      expect(tooManyFieldPaths.validateSync()?.errors.fieldPaths).toBeTruthy();
      expect(tooManyEvidenceClaims.validateSync()?.errors.evidenceClaimIds).toBeTruthy();
      expect(duplicateArrays.validateSync()?.errors.fieldPaths).toBeTruthy();
      expect(duplicateArrays.validateSync()?.errors.evidenceClaimIds).toBeTruthy();
    });

    it('models append-only supersession as a backward pointer', () => {
      const selfSupersession = new ReviewDecision(validReviewDecision());
      selfSupersession.supersedesDecisionId = selfSupersession._id;

      expect(reviewDecisionSchema.path('supersedesDecisionId').options.ref).toBe('ReviewDecision');
      expect(reviewDecisionSchema.path('supersededByDecisionId')).toBeUndefined();
      expect(reviewDecisionSchema.path('decisionType').options.immutable).toBe(true);
      expect(reviewDecisionSchema.path('rationale').options.immutable).toBe(true);
      expect(reviewDecisionSchema.path('updatedAt')).toBeUndefined();
      expect(selfSupersession.validateSync()?.errors.supersedesDecisionId).toBeTruthy();
      expect(reviewDecisionSchema.indexes()).toContainEqual([
        { supersedesDecisionId: 1 },
        {
          unique: true,
          partialFilterExpression: { supersedesDecisionId: { $type: 'objectId' } },
          background: true,
        },
      ]);
    });
  });
});
