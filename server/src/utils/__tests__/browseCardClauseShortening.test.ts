import { describe, expect, it } from 'vitest';

import { shortenCardLineToFitBrowseCard } from '../browseCardClauseShortening';

describe('shortenCardLineToFitBrowseCard (#4809)', () => {
  it('ends a card the browse card would cut at the last clause boundary that fits', () => {
    const card =
      'Investigates mechanisms of protein degradation by the ubiquitin–proteasome system in budding yeast, including ubiquitin conjugation, proteasome assembly and trafficking, and substrate recognition across stress conditions.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(
      'Investigates mechanisms of protein degradation by the ubiquitin–proteasome system in budding yeast.',
    );
  });

  it('cuts before a method clause when no qualifier boundary fits', () => {
    const card =
      'Investigates neurobiological substrates and intermediate phenotypes of psychotic and substance-related disorders in large longitudinal cohorts using multimodal imaging, EEG, cognitive testing and genetics.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(
      'Investigates neurobiological substrates and intermediate phenotypes of psychotic and substance-related disorders in large longitudinal cohorts.',
    );
  });

  it('never cuts inside a list or before a parenthesis', () => {
    const card =
      'Investigates neuropathophysiology of a post-viral syndrome with advanced brain MRI, vascular, neuronal and immunologic biomarkers, and neuropsychological testing of central, autonomic, and peripheral nervous system damage in humans.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('leaves a card that already fits untouched', () => {
    const card = 'Studies how cells divide during early development.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });
});
