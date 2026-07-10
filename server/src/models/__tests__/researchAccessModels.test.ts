import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AccessSignal } from '../accessSignal';
import { ContactRoute } from '../contactRoute';
import { EntryPathway } from '../entryPathway';
import { PostedOpportunity } from '../postedOpportunity';
import { mapResearchGroupKindToEntityType } from '../researchAccessTypes';
import { Source } from '../source';

const oid = () => new mongoose.Types.ObjectId();

describe('research access models', () => {
  it('maps legacy ResearchGroup kind values to target entity types', () => {
    expect(mapResearchGroupKindToEntityType('lab')).toBe('LAB');
    expect(mapResearchGroupKindToEntityType('center')).toBe('CENTER');
    expect(mapResearchGroupKindToEntityType('individual')).toBe('INDIVIDUAL_RESEARCH');
    expect(mapResearchGroupKindToEntityType('unknown')).toBe('LAB');
  });

  it('keeps legacy formalization-only pathway values readable for old rows', () => {
    const doc = new EntryPathway({
      researchEntityId: oid(),
      pathwayType: 'COURSE_CREDIT',
      status: 'RECURRING',
      evidenceStrength: 'STRONG',
      studentFacingLabel: 'Research for course credit',
      compensation: 'COURSE_CREDIT',
    });

    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects invalid entry pathway types', () => {
    const doc = new EntryPathway({
      researchEntityId: oid(),
      pathwayType: 'EMAIL_BLAST',
      studentFacingLabel: 'Bad path',
    });

    expect(doc.validateSync()?.errors['pathwayType']).toBeTruthy();
  });

  it('validates access signals with source-backed confidence fields', () => {
    const doc = new AccessSignal({
      researchEntityId: oid(),
      signalType: 'CREDIT_FORMALIZATION_POSSIBLE',
      confidence: 'HIGH',
      confidenceScore: 0.8,
      observedAt: new Date('2026-05-07T12:00:00.000Z'),
    });

    expect(doc.validateSync()).toBeUndefined();
  });

  it('defaults contact routes to authenticated visibility', () => {
    const doc = new ContactRoute({
      researchEntityId: oid(),
      routeType: 'LAB_MANAGER',
      email: 'manager@yale.edu',
    });

    expect(doc.validateSync()).toBeUndefined();
    expect((doc as any).visibility).toBe('AUTHENTICATED');
  });

  it('allows posted opportunities to wrap a legacy listing', () => {
    const doc = new PostedOpportunity({
      entryPathwayId: oid(),
      researchEntityId: oid(),
      listingId: oid(),
      title: 'Spring RA role',
      status: 'OPEN',
    });

    expect(doc.validateSync()).toBeUndefined();
  });

  it('validates source coverage metadata for scraper planning', () => {
    const doc = new Source({
      name: 'lab-microsite-undergrad-llm',
      displayName: 'Lab microsite LLM',
      defaultWeight: 0.5,
      coverage: {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: ['JOIN_INSTRUCTIONS', 'UNDERGRAD_ROLE_LANGUAGE'],
        defaultConfidence: 'MEDIUM',
      },
    });

    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects invalid source coverage artifact types', () => {
    const doc = new Source({
      name: 'bad-source',
      displayName: 'Bad source',
      defaultWeight: 0.5,
      coverage: {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['MassEmailTarget'],
        evidenceCategories: ['JOIN_INSTRUCTIONS'],
        defaultConfidence: 'MEDIUM',
      },
    });

    expect(doc.validateSync()?.errors['coverage.artifactTypes.0']).toBeTruthy();
  });
});
