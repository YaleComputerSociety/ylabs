import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Signal } from '../signal';
import { mapResearchGroupKindToEntityType, researchEntityTypes } from '../researchAccessTypes';
import { Source } from '../source';

const oid = () => new mongoose.Types.ObjectId();

describe('research access models', () => {
  it('maps legacy ResearchGroup kind values to target entity types', () => {
    expect(mapResearchGroupKindToEntityType('lab')).toBe('LAB');
    expect(mapResearchGroupKindToEntityType('center')).toBe('CENTER');
    expect(mapResearchGroupKindToEntityType('individual')).toBe('FACULTY_RESEARCH_AREA');
    expect(mapResearchGroupKindToEntityType('solo')).toBe('FACULTY_RESEARCH_AREA');
    expect(mapResearchGroupKindToEntityType('unknown')).toBe('LAB');
  });

  it('does not expose PROGRAM as a research entity type; programs live only on /programs', () => {
    expect(researchEntityTypes).not.toContain('PROGRAM');
    expect(mapResearchGroupKindToEntityType('program')).not.toBe('PROGRAM');
    expect(mapResearchGroupKindToEntityType('program')).toBe('INITIATIVE');
  });

  it('validates access signals with source-backed confidence fields', () => {
    const doc = new Signal({
      researchEntityId: oid(),
      type: 'CREDIT_FORMALIZATION_POSSIBLE',
      confidence: 'HIGH',
      confidenceScore: 0.8,
      observedAt: new Date('2026-05-07T12:00:00.000Z'),
    });

    expect(doc.validateSync()).toBeUndefined();
  });

  it('validates logistics signals folded into the same collection', () => {
    const doc = new Signal({
      researchEntityId: oid(),
      type: 'COMPENSATION',
      status: 'KNOWN',
      value: { modes: ['STIPEND'] },
      observedAt: new Date('2026-05-07T12:00:00.000Z'),
      expiresAt: new Date('2027-05-07T12:00:00.000Z'),
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
        artifactTypes: ['AccessSignal', 'Observation'],
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

  it('leaves re-crawl freshness fields unset when never crawled (#1705)', () => {
    const doc = new Source({
      name: 'never-crawled-source',
      displayName: 'Never crawled source',
      defaultWeight: 0.5,
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.lastCrawledAt).toBeUndefined();
    expect(doc.cadenceDays).toBeUndefined();
  });

  it('validates a re-crawled source with a target cadence', () => {
    const doc = new Source({
      name: 'recrawled-source',
      displayName: 'Recrawled source',
      defaultWeight: 0.5,
      lastCrawledAt: new Date('2026-05-07T12:00:00.000Z'),
      cadenceDays: 30,
    });

    expect(doc.validateSync()).toBeUndefined();
  });
});
