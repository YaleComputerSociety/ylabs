import { describe, expect, it } from 'vitest';
import {
  sourceCoverageArtifactTypes,
  sourceCoverageEvidenceCategories,
  sourceCoverageTiers,
} from '../../models/sourceCoverageTypes';
import { getSourceCoverage, sourceCoverageRegistry } from '../sourceCoverageRegistry';

const prioritySources = [
  'lab-microsite-description-llm',
  'lab-microsite-undergrad-llm',
  'dept-faculty-roster',
  'official-profile-enrichment',
  'undergrad-fellowships-recipients',
  'yale-college-fellowships-office',
  'ylabs-listing',
];

describe('sourceCoverageRegistry', () => {
  it('covers the roadmap priority sources', () => {
    for (const source of prioritySources) {
      expect(getSourceCoverage(source), source).toBeTruthy();
    }
  });

  it('does not expose retired Apify Scholar as active coverage', () => {
    expect(getSourceCoverage('apify-google-scholar')).toBeUndefined();
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
    expect(getSourceCoverage('dept-faculty-roster')?.artifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'ContactRoute']),
    );
    expect(getSourceCoverage('dept-faculty-roster')?.artifactTypes).not.toContain('AccessSignal');
    expect(getSourceCoverage('yale-directory')?.artifactTypes).toEqual(['Observation']);
    expect(getSourceCoverage('yale-directory-csv')?.artifactTypes).toEqual(['Observation']);
    expect(getSourceCoverage('official-profile-enrichment')?.artifactTypes).toEqual([
      'Observation',
    ]);
    expect(getSourceCoverage('yale-directory-csv')?.evidenceCategories).toEqual([
      'ENTITY_MEMBERSHIP',
    ]);
  });

  it('tracks fellowship office records as official application-cycle and route evidence', () => {
    const coverage = getSourceCoverage('yale-college-fellowships-office');

    expect(coverage?.artifactTypes).toEqual(
      expect.arrayContaining([
        'Fellowship',
        'EntryPathway',
        'AccessSignal',
        'ContactRoute',
        'PostedOpportunity',
      ]),
    );
    expect(coverage?.evidenceCategories).toEqual(
      expect.arrayContaining([
        'FELLOWSHIP_COMPATIBILITY',
        'APPLICATION_LINK',
        'OFFICIAL_CONTACT_ROUTE',
        'POSTED_OPENING',
      ]),
    );
  });

  it('classifies legacy YLabs listings as manual audit seeds, not scraper coverage proof', () => {
    const coverage = getSourceCoverage('ylabs-listing');

    expect(coverage?.tier).toBe('MANUAL_OVERRIDE');
    expect(coverage?.defaultConfidence).toBe('MEDIUM');
    expect(coverage?.artifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal', 'PostedOpportunity']),
    );
    expect(coverage?.notes).toMatch(/audit seed/i);
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
});
