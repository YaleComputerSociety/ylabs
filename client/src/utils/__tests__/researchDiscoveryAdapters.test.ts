import { describe, expect, it } from 'vitest';

import {
  buildPathwayEvidenceRows,
  buildGroupedSearchResults,
  buildResearchHomeContextLine,
  buildIdentityConfidenceRecords,
  getPathwayActionLabel,
  getPathwayTypeLabel,
  parseQueryInterpretationChips,
} from '../researchDiscoveryAdapters';
import type { ResearchEntity } from '../../types/researchEntity';
import type { PathwaySearchHit } from '../../types/pathway';

const entity = (overrides: Partial<ResearchEntity>): ResearchEntity => ({
  _id: overrides._id || 'entity-1',
  slug: overrides.slug || 'entity-1',
  name: overrides.name || 'Example Research Group',
  displayName: overrides.displayName,
  kind: overrides.kind || 'lab',
  description: overrides.description || 'Studies a focused research area.',
  websiteUrl: overrides.websiteUrl || '',
  location: overrides.location || '',
  departments: overrides.departments || [],
  researchAreas: overrides.researchAreas || [],
  school: overrides.school || '',
  openness: overrides.openness || 'unknown',
  typicalUndergradRoles: overrides.typicalUndergradRoles || [],
  prerequisiteCourses: overrides.prerequisiteCourses || [],
  creditOptions: overrides.creditOptions || [],
  fundingPrograms: overrides.fundingPrograms || [],
  contactEmail: overrides.contactEmail || '',
  contactName: overrides.contactName || '',
  contactRole: overrides.contactRole || '',
  sourceUrls: overrides.sourceUrls || [],
  ...overrides,
});

describe('pathway display helpers', () => {
  const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
    _id: 'pathway-1',
    pathwayType: 'POSTED_ROLE',
    status: 'ACTIVE',
    evidenceStrength: 'DIRECT',
    studentFacingLabel: 'Posted research role',
    explanation: 'A posted role mentions undergraduate research.',
    bestNextStep: 'Apply through the posted listing.',
    bestNextStepCategory: 'apply',
    confidence: 0.9,
    sourceUrls: ['https://example.yale.edu/posting'],
    researchEntity: {
      _id: 'entity-1',
      slug: 'mccormick-lab',
      name: 'McCormick Lab',
      departments: ['Neuroscience'],
      researchAreas: ['Systems neuroscience'],
    },
    evidence: [
      {
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        confidenceScore: 1,
        sourceUrl: 'https://example.yale.edu/posting',
        excerpt: 'Posted listing: David A. McCormick',
      },
    ],
    ...overrides,
  });

  it('maps best-next-step categories to student-facing actions', () => {
    expect(getPathwayActionLabel('apply')).toBe('Apply');
    expect(getPathwayActionLabel('contact-program')).toBe('Contact program');
    expect(getPathwayActionLabel('plan-outreach')).toBe('Plan targeted outreach');
    expect(getPathwayActionLabel('find-funding')).toBe('Find funding');
    expect(getPathwayActionLabel('register-for-credit')).toBe(
      'Ask about credit after finding a mentor',
    );
    expect(getPathwayActionLabel('save-for-thesis')).toBe('Save for thesis planning');
    expect(getPathwayActionLabel('check-back-later')).toBe('Save for later');
    expect(getPathwayActionLabel('save-for-later')).toBe('Save for later');
  });

  it('normalizes pathway type and evidence labels without raw enums', () => {
    expect(getPathwayTypeLabel('POSTED_ROLE')).toBe('Posted opening');
    expect(getPathwayTypeLabel('REACH_OUT_PLAUSIBLE')).toBe('Exploratory outreach');

    const evidenceRows = buildPathwayEvidenceRows(pathway());

    expect(evidenceRows[0]).toMatchObject({
      claim: 'A posted role mentions undergraduate research.',
      sourceType: 'Posted opening',
      url: 'https://example.yale.edu/posting',
    });
    expect(JSON.stringify(evidenceRows)).not.toContain('POSTED_OPENING');
    expect(JSON.stringify(evidenceRows)).not.toContain('POSTED_ROLE');
  });
});

describe('buildIdentityConfidenceRecords', () => {
  it('keeps same-name records separate and flags meaningful ambiguity', () => {
    const identities = buildIdentityConfidenceRecords([
      {
        id: 'ada-cs',
        name: 'Ada Lovelace',
        title: 'Professor',
        departments: ['Computer Science'],
        affiliations: ['Yale College'],
        netid: 'al123',
        sourceContext: 'Analytical Systems Lab',
      },
      {
        id: 'ada-math',
        name: 'Ada Lovelace',
        title: 'Lecturer',
        departments: ['Mathematics'],
        affiliations: ['Graduate School'],
        sourceContext: 'Mechanism Design Group',
      },
    ]);

    expect(identities).toHaveLength(2);
    expect(identities[0].name).toBe('Ada Lovelace');
    expect(identities[1].name).toBe('Ada Lovelace');
    expect(identities.every((identity) => identity.ambiguityLabel === 'Possible same-name ambiguity')).toBe(true);
    expect(identities[0].identityLabel).toBe('Identity: Yale-confirmed');
    expect(identities[1].identityLabel).toBe('Identity: unresolved');
  });
});

describe('buildGroupedSearchResults', () => {
  it('keeps research-home results as individual profile clusters', () => {
    const grouped = buildGroupedSearchResults({
      query: 'neuroscience',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'neuro-a',
          name: 'Neuro A',
          departments: ['Neuroscience'],
        }),
        entity({
          _id: 'b',
          slug: 'neuro-b',
          name: 'Neuro B',
          departments: ['Neuroscience'],
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.clusters.map((cluster) => cluster.label)).toEqual([
      'Neuro A',
      'Neuro B',
    ]);
    expect(grouped.clusters.every((cluster) => cluster.entityCount === 1)).toBe(true);
    expect(grouped.clusters[0].contextLine).toBe('Neuroscience');
  });

  it('collapses prefixed and plain department labels in research home cards', () => {
    const grouped = buildGroupedSearchResults({
      query: 'odonnell',
      researchEntities: [
        entity({
          _id: 'odonnell',
          slug: 'odonnell-lab',
          name: "O'Donnell Lab",
          departments: [
            'Molecular, Cellular & Developmental Biology',
            'MCDB - Molecular, Cellular & Developmental Biology',
          ],
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(buildResearchHomeContextLine(grouped.clusters[0].entities[0])).toBe(
      'Molecular, Cellular & Developmental Biology',
    );
    expect(grouped.clusters[0].contextLine).toBe('Molecular, Cellular & Developmental Biology');
    expect(grouped.clusters[0].metadataTags).toEqual([
      'Molecular, Cellular & Developmental Biology',
    ]);
  });

  it('adds profile links when contact emails identify Yale netids and exposes lab context', () => {
    const grouped = buildGroupedSearchResults({
      query: 'AI safety mechanism design',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'safe-ai',
          name: 'Safe AI Lab',
          researchAreas: ['AI Safety'],
          departments: ['Computer Science'],
          contactName: 'Grace Hopper',
          contactRole: 'PI',
          contactEmail: 'grace.hopper@yale.edu',
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.people).toHaveLength(1);
    expect(grouped.people[0].profileUrl).toBe('/profile/grace.hopper');
    expect(grouped.people[0].labName).toBe('Safe AI Lab');
    expect(grouped.people[0].labSlug).toBe('safe-ai');
  });

  it('returns clusters, people, pathways, papers, and interpretation chips', () => {
    const grouped = buildGroupedSearchResults({
      query: 'AI safety mechanism design',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'safe-ai',
          name: 'Safe AI Lab',
          researchAreas: ['AI Safety'],
          departments: ['Computer Science'],
          contactName: 'Grace Hopper',
          contactRole: 'PI',
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.clusters).toHaveLength(1);
    expect(grouped.people).toHaveLength(1);
    expect(grouped.papers).toEqual([]);
    expect(grouped.pathways).toEqual([]);
    expect(grouped.interpretationChips).toEqual([
      'Query: AI safety mechanism design',
      'Topic term: AI',
      'Topic term: safety',
      'Topic term: mechanism',
      'Topic term: design',
    ]);
  });
});

describe('parseQueryInterpretationChips', () => {
  it('drops tiny words and caps visible interpretation chips', () => {
    expect(parseQueryInterpretationChips('BCIs for ALS and protein folding')).toEqual([
      'Query: BCIs for ALS and protein folding',
      'Topic term: BCIs',
      'Topic term: ALS',
      'Topic term: protein',
      'Topic term: folding',
    ]);
  });
});
