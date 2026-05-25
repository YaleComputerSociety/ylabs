import { describe, expect, it } from 'vitest';
import { buildResearchSearchQuerySemantics } from '../researchSearchQuerySemantics';
import { rankResearchEntityCandidates } from '../researchSearchRanking';

describe('rankResearchEntityCandidates', () => {
  it('prefers direct research-home matches with descriptions over weak department coincidences', () => {
    const semantics = buildResearchSearchQuerySemantics('climate policy');
    const ranked = rankResearchEntityCandidates(
      [
        {
          id: 'weak',
          name: 'Economics Research',
          departments: ['Economics'],
          description: '',
          researchAreas: ['policy'],
          sourceUrls: [],
        },
        {
          id: 'strong',
          name: 'Environmental Policy Research Home',
          departments: ['School of the Environment'],
          description:
            'Research on climate policy, environmental governance, and energy policy.',
          researchAreas: ['climate policy', 'environmental policy'],
          sourceUrls: ['https://example.edu/environmental-policy'],
        },
      ],
      semantics,
      'hybrid',
    );

    expect(ranked[0].candidate.id).toBe('strong');
    expect(ranked[0].searchMatch.reason).toContain('climate policy');
    expect(ranked[0].searchMatch.mode).toBe('hybrid');
  });

  it('creates method explanations for student-language searches', () => {
    const semantics = buildResearchSearchQuerySemantics('wet lab');
    const ranked = rankResearchEntityCandidates(
      [
        {
          id: 'lab',
          name: 'Bench Methods Research Home',
          description: 'Bench research in molecular biology and cell biology.',
          researchAreas: ['molecular biology'],
          departments: ['Synthetic Biology Methods'],
          sourceUrls: ['https://example.edu/bench-methods'],
        },
      ],
      semantics,
      'expanded-keyword',
    );

    expect(ranked[0].searchMatch.methods).toContain('wet lab');
    expect(ranked[0].searchMatch.reason).toContain('wet lab');
  });

  it('drops semantic-expanded candidates that have no evidence in searchable text', () => {
    const semantics = buildResearchSearchQuerySemantics('archival research');
    const ranked = rankResearchEntityCandidates(
      [
        {
          id: 'clinical',
          name: 'Clinical Trials Lab',
          description: 'Studies clinical trials, substance use, and hospital interventions.',
          researchAreas: ['public health'],
          sourceUrls: ['https://example.edu/clinical'],
        },
      ],
      semantics,
      'expanded-keyword',
    );

    expect(ranked).toEqual([]);
  });

  it('treats canonical short and full descriptions as quality signals', () => {
    const semantics = buildResearchSearchQuerySemantics('decision making');
    const ranked = rankResearchEntityCandidates(
      [
        {
          id: 'legacy-summary',
          name: 'Decision Research',
          departments: ['Psychology'],
          summary: '',
          researchAreas: ['decision making'],
          sourceUrls: [],
        },
        {
          id: 'canonical-description',
          name: 'Decision Research',
          departments: ['Psychology'],
          shortDescription: 'Studies decision making across learning and uncertainty.',
          fullDescription:
            'The research home studies decision making across learning, uncertainty, and behavioral experiments.',
          researchAreas: ['decision making'],
          sourceUrls: [],
        },
      ],
      semantics,
      'expanded-keyword',
    );

    expect(ranked[0].candidate.id).toBe('canonical-description');
  });

  it('prefers exact multi-token matches over typo-like partial matches', () => {
    const semantics = buildResearchSearchQuerySemantics('blue silver');
    const ranked = rankResearchEntityCandidates(
      [
        {
          id: 'astrophysics',
          name: 'Blue Field Astrophysics Group',
          description: 'Research on blue-field surveys, galaxies, and high-energy astrophysics.',
          researchAreas: ['blue-field surveys', 'cosmology'],
          departments: ['Astronomy'],
          sourceUrls: ['https://example.edu/astro'],
        },
        {
          id: 'modeling',
          name: 'Blue-Silver Synthetic Modeling',
          description: 'Research on the blue-silver model, scenario pricing, and derivatives.',
          researchAreas: ['synthetic economics', 'mathematical modeling'],
          departments: ['Synthetic Economics'],
          sourceUrls: ['https://example.edu/modeling'],
        },
      ],
      semantics,
      'expanded-keyword',
    );

    expect(ranked[0].candidate.id).toBe('modeling');
    expect(ranked[0].searchMatch.concepts).toEqual([]);
    expect(ranked[0].searchMatch.methods).toEqual([]);
    expect(ranked[0].searchMatch.reason).toContain('blue silver');
  });
});
