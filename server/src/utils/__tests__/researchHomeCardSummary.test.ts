import { describe, expect, it } from 'vitest';
import { resolveResearchHomeCardSummary } from '../researchHomeCardSummary';

describe('resolveResearchHomeCardSummary', () => {
  it('prefers a grounded shortDescription when the fullDescription is useful', () => {
    const summary = resolveResearchHomeCardSummary({
      shortDescription:
        'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      fullDescription:
        'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
    });

    expect(summary).toEqual({
      text: 'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('falls back to fullDescription when the short description is a weak lab-scaffold sentence', () => {
    const summary = resolveResearchHomeCardSummary({
      shortDescription: 'My lab focuses on cancer topics.',
      fullDescription: 'This lab studies pediatric oncology and immunotherapy resistance.',
    });

    expect(summary).toEqual({
      text: 'This lab studies pediatric oncology and immunotherapy resistance.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('falls back to profileSynthesisDescription when the fullDescription is not useful', () => {
    const summary = resolveResearchHomeCardSummary({
      shortDescription: 'Professor of Chemistry',
      fullDescription: 'Director of Department Cores',
      profileSynthesisDescription: 'Works on catalysis and green chemistry synthesis routes.',
    });

    expect(summary).toEqual({
      text: 'Works on catalysis and green chemistry synthesis routes.',
      state: 'complete',
      label: 'Profile context',
    });
  });

  it('falls back to a usable shortDescription when the fullDescription trips the unusable-content guard', () => {
    const summary = resolveResearchHomeCardSummary({
      shortDescription: 'Studies the molecular basis of neurotransmitter signaling in C. elegans.',
      fullDescription: 'Course Director ENGL 1020, Introduction to Literary Study.',
    });

    expect(summary).toEqual({
      text: 'Studies the molecular basis of neurotransmitter signaling in C. elegans.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('returns a sparse department-aware fallback when no description survives', () => {
    const summary = resolveResearchHomeCardSummary({
      departments: ['Astronomy'],
      sourceUrls: ['https://astronomy.yale.edu/lab'],
    });

    expect(summary.state).toBe('sparse');
    expect(summary.text).toContain('Astronomy');
  });

  it('returns a generic sparse fallback when nothing else is available', () => {
    const summary = resolveResearchHomeCardSummary({});

    expect(summary).toEqual({
      text: 'Limited public description. This profile needs source review before fit can be assessed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });
});
