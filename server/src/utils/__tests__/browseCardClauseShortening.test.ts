import { describe, expect, it } from 'vitest';

import { shortenCardLineToFitBrowseCard } from '../browseCardClauseShortening';
import { assessResearchEntityDescriptionQuality } from '../researchEntityDescriptionQuality';

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

  it('does not cut before a through that is not a method clause', () => {
    const card =
      'Investigates how mood, sleep and cognition change from adolescence through early adulthood in large community cohorts followed over many years, measuring daily affect, sleep timing, executive function and peer relationships.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('does not cut where the head would end in an abbreviation', () => {
    const card =
      'Investigates social and economic determinants of cardiovascular health outcomes among older adults in the U.S., including neighborhood deprivation, insurance coverage, food access, and long-term exposure to air pollution.';
    const served = shortenCardLineToFitBrowseCard(card);
    expect(served).toBe(card);
    expect(served).not.toContain('U.S..');
    expect(
      assessResearchEntityDescriptionQuality({ shortDescription: served }).short.flags,
    ).not.toContain('incomplete-sentence');
  });

  it('leaves a card that already fits untouched', () => {
    const card = 'Studies how cells divide during early development.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });
});
