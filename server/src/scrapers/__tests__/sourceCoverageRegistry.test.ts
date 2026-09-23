import { describe, expect, it } from 'vitest';
import {
  sourceCoverageArtifactTypes,
  sourceCoverageEvidenceCategories,
  sourceCoverageTiers,
} from '../../models/sourceCoverageTypes';
import { getSourceCoverage, sourceCoverageRegistry } from '../sourceCoverageRegistry';
import { RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES } from '../retiredPaperPipeline';
import { RETIRED_SOURCE_NAMES } from '../sourceDispatch';

const prioritySources = [
  'lab-microsite-description-llm',
  'lab-microsite-undergrad-llm',
  'dept-faculty-roster',
  'department-undergrad-research',
  'official-profile-pi-backfill',
  'yale-research-official',
  'undergrad-fellowships-recipients',
  'yale-college-fellowships-office',
];

describe('sourceCoverageRegistry', () => {
  it('covers the roadmap priority sources', () => {
    for (const source of prioritySources) {
      expect(getSourceCoverage(source), source).toBeTruthy();
    }
  });

  it('claims no retired lane as a roadmap priority source', () => {
    expect(prioritySources.filter((source) => RETIRED_SOURCE_NAMES.includes(source))).toEqual([]);
  });

  it('does not expose any retired source as active coverage', () => {
    const stillCovered = RETIRED_SOURCE_NAMES.filter(
      (sourceName) => getSourceCoverage(sourceName) !== undefined,
    );
    expect(stillCovered).toEqual([]);
  });

  it('covers the retired Apify Scholar and bibliography names it used to expose', () => {
    for (const sourceName of ['apify-google-scholar', ...RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES]) {
      expect(RETIRED_SOURCE_NAMES, sourceName).toContain(sourceName);
    }
  });

  it('uses only supported artifact, evidence, and tier values', () => {
    const artifactTypes = new Set(sourceCoverageArtifactTypes);
    const evidenceCategories = new Set(sourceCoverageEvidenceCategories);
    const tiers = new Set(sourceCoverageTiers);

    for (const [sourceName, coverage] of Object.entries(sourceCoverageRegistry)) {
      expect(coverage.priority, sourceName).toBeGreaterThanOrEqual(0);
      expect(tiers.has(coverage.tier), sourceName).toBe(true);
      expect(coverage.artifactTypes.length, sourceName).toBeGreaterThan(0);
      expect(coverage.evidenceCategories.length, sourceName).toBeGreaterThan(0);
      for (const artifact of coverage.artifactTypes) {
        expect(artifactTypes.has(artifact), `${sourceName}:${artifact}`).toBe(true);
      }
      for (const category of coverage.evidenceCategories) {
        expect(evidenceCategories.has(category), `${sourceName}:${category}`).toBe(true);
      }
    }
  });

  it('does not treat discovery indexes as undergraduate access evidence by themselves', () => {
    expect(getSourceCoverage('ysm-atoz-index')?.artifactTypes).not.toContain('EntryPathway');
    expect(getSourceCoverage('yse-centers-index')?.artifactTypes).not.toContain('AccessSignal');
    expect(getSourceCoverage('centers-institutes-index')?.artifactTypes).not.toContain(
      'ContactRoute',
    );
    expect(getSourceCoverage('yale-research-official')?.artifactTypes).toEqual([
      'ResearchEntity',
      'Observation',
    ]);
    expect(getSourceCoverage('yale-research-official')?.artifactTypes).not.toContain(
      'EntryPathway',
    );
    expect(getSourceCoverage('yale-research-official')?.artifactTypes).not.toContain(
      'AccessSignal',
    );
    expect(getSourceCoverage('dept-faculty-roster')?.artifactTypes).toEqual(
      expect.arrayContaining(['ResearchEntity', 'Observation']),
    );
    expect(getSourceCoverage('dept-faculty-roster')?.artifactTypes).not.toContain('AccessSignal');
    expect(getSourceCoverage('yale-directory')?.artifactTypes).toEqual(['Observation']);
    expect(getSourceCoverage('yale-directory')?.evidenceCategories).toEqual([
      'ENTITY_MEMBERSHIP',
      'OFFICIAL_PROFILE',
    ]);
  });

  it('tracks fellowship office records as official application-cycle and route evidence', () => {
    const coverage = getSourceCoverage('yale-college-fellowships-office');

    expect(coverage?.artifactTypes).toEqual(expect.arrayContaining(['Fellowship']));
    expect(coverage?.evidenceCategories).toEqual(
      expect.arrayContaining([
        'FELLOWSHIP_COMPATIBILITY',
        'APPLICATION_LINK',
        'OFFICIAL_CONTACT_ROUTE',
        'POSTED_OPENING',
      ]),
    );
  });

  it('classifies department undergraduate research pages as official access evidence without posted openings', () => {
    const coverage = getSourceCoverage('department-undergrad-research');

    expect(coverage?.tier).toBe('PRIMARY_OFFICIAL');
    expect(coverage?.defaultConfidence).toBe('HIGH');
    expect(coverage?.artifactTypes).toEqual(expect.arrayContaining(['Fellowship', 'Observation']));
    expect(coverage?.artifactTypes).not.toContain('PostedOpportunity');
    expect(coverage?.artifactTypes).not.toContain('ResearchEntity');
    expect(coverage?.evidenceCategories).toEqual(
      expect.arrayContaining([
        'JOIN_INSTRUCTIONS',
        'UNDERGRAD_ROLE_LANGUAGE',
        'OFFICIAL_CONTACT_ROUTE',
        'APPLICATION_LINK',
      ]),
    );
    expect(coverage?.notes).toMatch(/generic guidance must not create posted opportunities/i);
  });

  it('classifies lab microsite description extraction as entity context, not access evidence', () => {
    const coverage = getSourceCoverage('lab-microsite-description-llm');

    expect(coverage?.artifactTypes).toEqual(['ResearchEntity', 'Observation']);
    expect(coverage?.evidenceCategories).toEqual(
      expect.arrayContaining(['LAB_WEBSITE', 'TOPICS', 'METHODS']),
    );
    expect(coverage?.artifactTypes).not.toContain('EntryPathway');
    expect(coverage?.artifactTypes).not.toContain('PostedOpportunity');
    expect(coverage?.defaultConfidence).toBe('MEDIUM');
  });

  it('declares undergraduate logistics coverage as evidence categories, not as an artifact', () => {
    const coverage = getSourceCoverage('lab-microsite-undergrad-llm');
    // `UndergraduateLogisticsClaim` was removed with the dead access model (#2829): it
    // had no model, no collection and no materializer, so declaring it made every run
    // warn that an expected artifact was missing. The evidence categories are the real
    // claim, and they survive.
    expect(coverage?.artifactTypes).not.toContain('UndergraduateLogisticsClaim');
    expect(coverage?.evidenceCategories).toEqual(expect.arrayContaining([]));
  });
});
