import { describe, expect, it } from 'vitest';

import {
  buildGroupedSearchResults,
  buildResearchHomeContextLine,
  buildIdentityConfidenceRecords,
  formatSourceLabel,
  getPathwayTypeLabel,
  parseQueryInterpretationChips,
  schoolFilterCardContext,
} from '../researchDiscoveryAdapters';
import type { ResearchEntity } from '../../types/researchEntity';

const entity = (overrides: Partial<ResearchEntity>): ResearchEntity => ({
  _id: overrides._id || 'entity-1',
  slug: overrides.slug || 'entity-1',
  name: overrides.name || 'Example Research Group',
  displayName: overrides.displayName,
  kind: overrides.kind || 'lab',
  fullDescription: overrides.fullDescription || 'Studies a focused research area.',
  websiteUrl: overrides.websiteUrl || '',
  departments: overrides.departments || [],
  researchAreas: overrides.researchAreas || [],
  school: overrides.school || '',
  contactEmail: overrides.contactEmail || '',
  contactName: overrides.contactName || '',
  contactRole: overrides.contactRole || '',
  sourceUrls: overrides.sourceUrls || [],
  ...overrides,
});

describe('pathway display helpers', () => {
  it('normalizes pathway type labels without raw enums', () => {
    expect(getPathwayTypeLabel('POSTED_ROLE')).toBe('Posted opening');
    expect(getPathwayTypeLabel('EXPLORATORY_CONTACT')).toBe('Exploratory outreach');
  });

  it('does not trust credential-bearing Yale-looking source URLs', () => {
    expect(formatSourceLabel('https://operator:secret@medicine.yale.edu/profile/example')).toBe(
      'Source',
    );
    expect(formatSourceLabel('https://medicine.yale.edu/profile/example')).toBe(
      'medicine.yale.edu',
    );
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
    expect(
      identities.every((identity) => identity.ambiguityLabel === 'Possible same-name ambiguity'),
    ).toBe(true);
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
    });

    expect(grouped.clusters.map((cluster) => cluster.label)).toEqual(['Neuro A', 'Neuro B']);
    expect(grouped.clusters.every((cluster) => cluster.entityCount === 1)).toBe(true);
    expect(grouped.clusters[0].contextLine).toBe('Neuroscience');
  });

  it('uses a server-resolved cardDescription instead of re-deriving from absent raw fields (#1583)', () => {
    const grouped = buildGroupedSearchResults({
      query: 'neuroscience',
      researchEntities: [
        entity({
          _id: 'trimmed',
          slug: 'trimmed-lab',
          name: 'Trimmed Lab',
          departments: ['Neuroscience'],
          shortDescription: undefined,
          fullDescription: undefined,
          cardDescription: {
            text: 'Server-resolved summary text.',
            state: 'complete',
            label: 'Research description',
          },
        }),
      ],
      pathways: [],
    });

    expect(grouped.clusters[0].description).toBe('Server-resolved summary text.');
    expect(grouped.clusters[0].contextState).toBe('complete');
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
    });

    expect(buildResearchHomeContextLine(grouped.clusters[0].entities[0])).toBe(
      'Molecular, Cellular & Developmental Biology',
    );
    expect(grouped.clusters[0].contextLine).toBe('Molecular, Cellular & Developmental Biology');
    expect(grouped.clusters[0].metadataTags).toEqual([
      'Molecular, Cellular & Developmental Biology',
    ]);
  });

  it('falls back to schools[] when the scalar school is empty on research home cards', () => {
    const grouped = buildGroupedSearchResults({
      query: 'efficient computing',
      researchEntities: [
        entity({
          _id: 'ecl',
          slug: 'ecl',
          name: 'The Efficient Computing Lab (ECL)',
          departments: ['Computer Science'],
          school: '',
          schools: ['School of Engineering & Applied Science'],
        }),
      ],
      pathways: [],
    });

    expect(buildResearchHomeContextLine(grouped.clusters[0].entities[0])).toBe(
      'Computer Science · School of Engineering & Applied Science',
    );
    expect(grouped.clusters[0].contextLine).toBe(
      'Computer Science · School of Engineering & Applied Science',
    );
  });

  it('prefers the scalar school over schools[] when both are present', () => {
    expect(
      buildResearchHomeContextLine(
        entity({
          departments: ['Therapeutic Radiology'],
          school: 'School of Medicine',
          schools: ['School of Nursing'],
        }),
      ),
    ).toBe('Therapeutic Radiology · School of Medicine');
  });

  describe('schoolFilterCardContext', () => {
    const SEAS = 'School of Engineering & Applied Science';
    const jointAppointment = entity({
      departments: ['Biomedical Engineering', 'Psychiatry'],
      school: 'School of Medicine',
      schools: ['School of Medicine', SEAS],
    });
    const contextFor = (row: ResearchEntity, filteredSchool?: string) =>
      schoolFilterCardContext(row, filteredSchool, buildResearchHomeContextLine(row));

    it('leaves a card unchanged when no School filter is active', () => {
      expect(contextFor(jointAppointment)).toEqual({
        contextLine: 'Biomedical Engineering · Psychiatry · School of Medicine',
        alsoInSchool: '',
      });
      expect(contextFor(jointAppointment, '  ')).toEqual({
        contextLine: 'Biomedical Engineering · Psychiatry · School of Medicine',
        alsoInSchool: '',
      });
    });

    it('says "Also in" when the row matches only through a secondary appointment', () => {
      expect(contextFor(jointAppointment, SEAS)).toEqual({
        contextLine: 'Biomedical Engineering · Psychiatry · School of Medicine',
        alsoInSchool: `Also in ${SEAS}`,
      });
    });

    it('adds nothing when the primary school already names the filtered school', () => {
      expect(contextFor(jointAppointment, 'school of  medicine')).toEqual({
        contextLine: 'Biomedical Engineering · Psychiatry · School of Medicine',
        alsoInSchool: '',
      });
    });

    it('keeps the primary school visible when departments would crowd it out', () => {
      const crowded = entity({
        departments: ['Computer Science', 'Economics', 'Statistics & Data Science'],
        school: SEAS,
      });
      expect(buildResearchHomeContextLine(crowded)).not.toContain(SEAS);
      expect(contextFor(crowded, SEAS)).toEqual({
        contextLine: `Computer Science · Economics · ${SEAS}`,
        alsoInSchool: '',
      });
    });

    it('reads the schools[] fallback as the primary school when the scalar is empty', () => {
      const fallback = entity({ departments: ['Computer Science'], school: '', schools: [SEAS] });
      expect(contextFor(fallback, SEAS)).toEqual({
        contextLine: `Computer Science · ${SEAS}`,
        alsoInSchool: '',
      });
    });

    it('claims no membership the served row does not carry', () => {
      const unrelated = entity({ departments: ['Nursing'], school: 'School of Nursing' });
      expect(contextFor(unrelated, SEAS)).toEqual({
        contextLine: 'Nursing · School of Nursing',
        alsoInSchool: '',
      });
      expect(schoolFilterCardContext(undefined, SEAS, '')).toEqual({
        contextLine: '',
        alsoInSchool: '',
      });
    });
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
    });

    expect(grouped.people).toHaveLength(1);
    expect(grouped.people[0].labName).toBe('Safe AI Lab');
    expect(grouped.people[0].labSlug).toBe('safe-ai');
  });

  it('returns clusters, people, pathways, and interpretation chips', () => {
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
    });

    expect(grouped.clusters).toHaveLength(1);
    expect(grouped.people).toHaveLength(1);
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
