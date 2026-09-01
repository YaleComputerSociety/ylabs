import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Signal } from '../signal';
import {
  EntityTypeToResearchGroupKind,
  ResearchGroupKindToEntityType,
  mapEntityTypeToResearchGroupKind,
  mapResearchGroupKindToEntityType,
  researchEntityTypes,
  researchGroupKinds,
} from '../researchAccessTypes';
import {
  CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
  isLegacyFacultyResearchEntityType,
  LEGACY_FACULTY_RESEARCH_ENTITY_TYPES,
} from '../../scripts/consolidateFacultyResearchEntityTypeCore';
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
    expect(mapResearchGroupKindToEntityType('group')).toBe('INITIATIVE');
    expect(mapResearchGroupKindToEntityType('program')).toBe('INITIATIVE');
  });

  it('does not expose the legacy faculty-research duplicates, and leaves stored rows unreclassified (#2219)', () => {
    for (const legacy of LEGACY_FACULTY_RESEARCH_ENTITY_TYPES) {
      expect(researchEntityTypes as readonly string[]).not.toContain(legacy);
      // The consolidation lane must still recognize them so unmigrated
      // environments can be fixed.
      expect(isLegacyFacultyResearchEntityType(legacy)).toBe(true);
    }
    expect(CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE).toBe('FACULTY_RESEARCH_AREA');
    expect(researchEntityTypes).toContain('FACULTY_RESEARCH_AREA');
  });

  it('derives a valid research group kind for every entity type', () => {
    for (const entityType of researchEntityTypes) {
      const kind = mapEntityTypeToResearchGroupKind(entityType);
      expect(kind).toBe(EntityTypeToResearchGroupKind[entityType]);
      expect(researchGroupKinds).toContain(kind);
    }
    expect(mapEntityTypeToResearchGroupKind('CORE_FACILITY')).toBe('core_facility');
    expect(mapEntityTypeToResearchGroupKind('unknown')).toBe('lab');
  });

  it('round-trips every legacy kind back to its own entity type through the inverse map', () => {
    for (const kind of researchGroupKinds) {
      const entityType = ResearchGroupKindToEntityType[kind];
      expect(mapResearchGroupKindToEntityType(mapEntityTypeToResearchGroupKind(entityType))).toBe(
        entityType,
      );
    }
  });

  it('collapses the legacy kinds that share an entity type with another kind', () => {
    const derivedFromOwnEntityType = Object.fromEntries(
      researchGroupKinds.map((kind) => [
        kind,
        mapEntityTypeToResearchGroupKind(ResearchGroupKindToEntityType[kind]),
      ]),
    );

    expect(derivedFromOwnEntityType).toEqual({
      lab: 'lab',
      center: 'center',
      institute: 'institute',
      program: 'initiative',
      initiative: 'initiative',
      group: 'initiative',
      individual: 'individual',
      solo: 'individual',
      core_facility: 'core_facility',
    });
    // COURSE_SEQUENCE and GROUP were retired (#2202), so no surviving entity type
    // derives the `program` or `group` kinds: both are stored legacy values only.
    expect(Object.values(EntityTypeToResearchGroupKind)).not.toContain('program');
    expect(Object.values(EntityTypeToResearchGroupKind)).not.toContain('group');
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
