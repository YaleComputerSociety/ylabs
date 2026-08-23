import { describe, expect, it } from 'vitest';
import {
  isProseNotTopicPhrase,
  isResearchSectionLabel,
  stripResearchSectionLabelPrefix,
} from '../researchAreaLabels';

describe('researchAreaLabels', () => {
  it('flags section-heading labels regardless of trailing colon or casing', () => {
    for (const label of [
      'Research Areas:',
      'Research Areas',
      'research area',
      'Research Interests',
      'Research Interests:',
      'Fields of Interest',
      'Field of Study',
      'Areas of Interest',
      'Topics',
      'Topics:',
      'Topic',
      '',
      '   ',
    ]) {
      expect(isResearchSectionLabel(label)).toBe(true);
    }
  });

  it('does not flag genuine topical noun phrases', () => {
    for (const topic of [
      'Condensed Matter Physics',
      'Quantum criticality',
      'Coherent control of light transport and absorption',
      'Market design',
    ]) {
      expect(isResearchSectionLabel(topic)).toBe(false);
    }
  });

  it('rejects sentence-shaped prose but keeps short multi-word phrases', () => {
    expect(
      isProseNotTopicPhrase(
        'The lab studies condensed matter physics. It also builds random lasers.',
      ),
    ).toBe(true);
    expect(
      isProseNotTopicPhrase('Coherent control of light transport and absorption'),
    ).toBe(false);
    expect(isProseNotTopicPhrase('Random lasers')).toBe(false);
  });

  it('strips a leading section-heading label prefix from a joined value', () => {
    expect(stripResearchSectionLabelPrefix('Research Areas: Biophysics')).toBe('Biophysics');
    expect(stripResearchSectionLabelPrefix('Topics: Market design')).toBe('Market design');
    expect(stripResearchSectionLabelPrefix('Condensed Matter Physics')).toBe(
      'Condensed Matter Physics',
    );
  });
});
