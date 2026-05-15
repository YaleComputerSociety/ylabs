import { describe, expect, it } from 'vitest';

import {
  buildPathwayEvidenceRows,
  buildDynamicSearchSuggestions,
  buildGroupedSearchResults,
  buildIdentityConfidenceRecords,
  buildMetadataClusters,
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
    expect(getPathwayActionLabel('apply')).toBe('Apply or view posting');
    expect(getPathwayActionLabel('contact-program')).toBe('Contact program');
    expect(getPathwayActionLabel('plan-outreach')).toBe('Plan outreach');
    expect(getPathwayActionLabel('find-funding')).toBe('Find funding');
    expect(getPathwayActionLabel('register-for-credit')).toBe(
      'Ask about credit after finding a mentor',
    );
    expect(getPathwayActionLabel('save-for-thesis')).toBe('Save for thesis planning');
    expect(getPathwayActionLabel('check-back-later')).toBe('Save for later');
    expect(getPathwayActionLabel('save-for-later')).toBe('Save for later');
  });

  it('normalizes pathway type and evidence labels without raw enums', () => {
    expect(getPathwayTypeLabel('POSTED_ROLE')).toBe('Posted role');
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

describe('buildMetadataClusters', () => {
  it('groups research entities by department before research area metadata', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'ai-lab',
        name: 'AI Lab',
        researchAreas: ['Machine Learning'],
        departments: ['Psychology'],
        sourceUrls: ['https://cs.example.edu/ai'],
      }),
      entity({
        _id: 'b',
        slug: 'ml-center',
        name: 'ML Center',
        researchAreas: ['Machine Learning'],
        departments: ['Psychology'],
      }),
      entity({
        _id: 'c',
        slug: 'brain-lab',
        name: 'Brain Lab',
        researchAreas: ['Neuroscience'],
        departments: ['Biology'],
      }),
    ]);

    expect(clusters.map((cluster) => cluster.label)).toEqual([
      'Psychology',
      'Biology',
    ]);
    expect(clusters[0].entityCount).toBe(2);
    expect(clusters[0].labels).toEqual(['Evidence-backed grouping']);
    expect(clusters[0].matchReason).toBe('Shared department: Psychology');
    expect(clusters[0].description).toBe(
      'Studies a focused research area.',
    );
    expect(clusters[0].evidence[0]).toMatchObject({
      claim: '2 Yale research profiles share Psychology metadata.',
      sourceType: 'Research metadata',
      url: 'https://cs.example.edu/ai',
    });
  });

  it('presents research-home labels without internal cluster badges', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'neuro-a',
        name: 'Neuro A',
        description: '',
        departments: ['Neuroscience'],
        researchAreas: ['Brain imaging'],
        sourceUrls: ['https://example.yale.edu/neuro'],
      }),
    ]);

    expect(clusters[0].labels).toEqual(['Evidence-backed grouping']);
    expect(clusters[0].matchReason).toBe('Shared department: Neuroscience');
    expect(clusters[0].description).toBe(
      'Research homes connected by Yale department metadata for Neuroscience.',
    );
    expect(clusters[0].labels.join(' ')).not.toContain('Cluster:');
  });

  it('normalizes department labels before grouping so case-only variants do not split clusters', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'neuro-club',
        name: 'Neuro Club',
        departments: ['NEUROSCIENCES'],
      }),
      entity({
        _id: 'b',
        slug: 'neuro-cohort',
        name: 'Neuro Cohort',
        departments: ['neurosciences'],
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe('NEUROSCIENCES');
    expect(clusters[0].matchReason).toBe('Shared department: NEUROSCIENCES');
    expect(clusters[0].entityCount).toBe(2);
  });

  it('normalizes near-identical department spellings before grouping', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'neuro-a',
        name: 'Neuro A',
        researchAreas: ['Neuroscience'],
        departments: ['NEUROSCIENCES'],
      }),
      entity({
        _id: 'b',
        slug: 'neuro-b',
        name: 'Neuro B',
        departments: ['Neuroscience'],
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe('NEUROSCIENCES');
    expect(clusters[0].matchReason).toBe('Shared department: NEUROSCIENCES');
    expect(clusters[0].metadataTags).not.toContain('Neuroscience');
  });

  it('normalizes department punctuation and conjunction variants before grouping', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'bio-a',
        name: 'Bio A',
        departments: ['Molecular, Cellular and Developmental Biology'],
      }),
      entity({
        _id: 'b',
        slug: 'bio-b',
        name: 'Bio B',
        departments: ['Molecular, Cellular & Developmental Biology'],
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe('Molecular, Cellular and Developmental Biology');
    expect(clusters[0].matchReason).toBe('Shared department: Molecular, Cellular and Developmental Biology');
  });

  it('falls back to department and school metadata when research areas are absent', () => {
    const clusters = buildMetadataClusters([
      entity({
        _id: 'a',
        slug: 'econ-one',
        name: 'Econ One',
        departments: ['Economics'],
        school: 'Yale College',
      }),
      entity({
        _id: 'b',
        slug: 'college-program',
        name: 'College Program',
        departments: [],
        school: 'Yale College',
      }),
    ]);

    expect(clusters.map((cluster) => cluster.label)).toEqual([
      'Economics',
      'Yale College',
    ]);
  });
});

describe('buildDynamicSearchSuggestions', () => {
  it('derives suggested searches from visible research metadata before fallback topics', () => {
    const suggestions = buildDynamicSearchSuggestions(
      [
        entity({
          _id: 'a',
          slug: 'protein-lab',
          name: 'Protein Lab',
          researchAreas: ['Protein folding', 'Computational biology'],
          departments: ['Molecular Biophysics and Biochemistry'],
          school: 'Yale College',
          recentPaperCount: 9,
        }),
        entity({
          _id: 'b',
          slug: 'protein-center',
          name: 'Protein Center',
          researchAreas: ['Protein folding'],
          departments: ['Chemistry'],
          school: 'School of Medicine',
          recentPaperCount: 4,
        }),
        entity({
          _id: 'c',
          slug: 'markets',
          name: 'Markets Lab',
          researchAreas: ['Mechanism design'],
          departments: ['Economics'],
          school: 'Yale College',
        }),
      ],
      { fallback: ['machine learning', 'AI safety'], limit: 4 },
    );

    expect(suggestions).toEqual([
      'Protein folding',
      'Mechanism design',
      'Computational biology',
      'Molecular Biophysics and Biochemistry',
    ]);
  });

  it('falls back when live metadata has not loaded yet', () => {
    expect(
      buildDynamicSearchSuggestions([], {
        fallback: ['machine learning', 'mechanism design'],
        limit: 4,
      }),
    ).toEqual(['machine learning', 'mechanism design']);
  });

  it('deduplicates near-identical metadata suggestions with readable casing', () => {
    const suggestions = buildDynamicSearchSuggestions(
      [
        entity({
          _id: 'a',
          slug: 'neuro-a',
          name: 'Neuro A',
          researchAreas: ['NEUROSCIENCES'],
          departments: ['Psychology'],
        }),
        entity({
          _id: 'b',
          slug: 'neuro-b',
          name: 'Neuro B',
          researchAreas: ['Neuroscience'],
          departments: ['Molecular, Cellular & Developmental Biology'],
        }),
        entity({
          _id: 'c',
          slug: 'neuro-c',
          name: 'Neuro C',
          departments: ['Molecular, Cellular and Developmental Biology'],
        }),
      ],
      { limit: 4 },
    );

    expect(suggestions).toEqual([
      'Neuroscience',
      'Molecular, Cellular & Developmental Biology',
      'Psychology',
    ]);
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
