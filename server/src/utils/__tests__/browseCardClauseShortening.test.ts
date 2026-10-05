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

  it('cuts before a second coordinated clause, leaving the first whole', () => {
    const card =
      'Studies how germline cells undergo programmed incomplete cytokinesis to form interconnected cell clusters during gamete development, and how tissue-specific stop codon readthrough produces extended proteins.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(
      'Studies how germline cells undergo programmed incomplete cytokinesis to form interconnected cell clusters during gamete development.',
    );
  });

  it('does not cut before an and that continues a noun list', () => {
    const card =
      'Characterizes the structure, function and uses of membrane transporters in bacterial cell envelopes in antibiotic resistance and drug delivery across many clinically relevant pathogen species and their hosts.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('cuts before an example list that has no comma', () => {
    const card =
      'Studies how environmental exposures, metabolism and antioxidant systems contribute to human diseases such as liver disease, obesity and diabetes, cancer, and neurodegenerative disorders of aging in large human cohorts.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(
      'Studies how environmental exposures, metabolism and antioxidant systems contribute to human diseases.',
    );
  });

  it('cuts before a focus phrase without an article and before a purpose clause', () => {
    expect(
      shortenCardLineToFitBrowseCard(
        'Studies the genetic and epigenetic architecture of psychiatric disorders, with focus on substance use disorders, post-traumatic stress disorder, major depression, anxiety, and related traits in large cohorts.',
      ),
    ).toBe('Studies the genetic and epigenetic architecture of psychiatric disorders.');
    expect(
      shortenCardLineToFitBrowseCard(
        'Studies the pathogenesis of congenital hydrocephalus by using frog embryos as an in vivo model to analyze how ependymal cilia and embryonic cerebrospinal fluid circulation regulate brain and ventricle development.',
      ),
    ).toBe(
      'Studies the pathogenesis of congenital hydrocephalus by using frog embryos as an in vivo model.',
    );
  });

  it('does not cut before an em-dash aside that the sentence closes', () => {
    const card =
      'Studies how steroid hormone signaling in the uterus — especially glucocorticoid receptor activity and crosstalk with other receptors — influences early pregnancy events and the growth of uterine fibroids.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('does not cut before an en-dash aside that the sentence closes', () => {
    const card =
      'Studies how steroid hormone signaling in the uterus – especially glucocorticoid receptor activity and crosstalk with other receptors – influences early pregnancy events and the growth of uterine fibroids.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('does not cut before a dash-and aside that the sentence closes', () => {
    const card =
      'Studies how steroid hormone signaling in the uterus — and its crosstalk with other nuclear receptors — influences early pregnancy events, implantation, and the growth of uterine fibroids in women.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('cuts before a spaced em-dash aside the sentence leaves open', () => {
    const card =
      'Studies how steroid hormone signaling shapes the uterus and placenta — especially glucocorticoid receptor activity, crosstalk with other steroid receptors, implantation, pregnancy loss, and uterine fibroids.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(
      'Studies how steroid hormone signaling shapes the uterus and placenta.',
    );
  });

  it.each([
    'Research in the fixture laboratory has focused on how cortical circuits encode reward and punishment across learning, sleep, stress, aging, and disease states in rodents, primates, and humans over many decades.',
    'The fixture laboratory is primarily focused on how cortical circuits encode reward and punishment across learning, sleep, stress, aging, and disease states in rodents, primates, and humans over many decades.',
    'The fixture laboratory aims to understand how cortical circuits encode reward and punishment across learning, sleep, stress, aging, and disease states in rodents, primates, and humans over many decades.',
    'Develops computational methods for cortical recordings that can be used to identify how circuits encode reward and punishment across learning, sleep, stress, aging, and disease states in many model species.',
    'Studies synaptic loss and memory decline in the aging brain mediated by signaling between microglia, astrocytes, and neurons across learning, sleep, stress, and disease states in rodents and in humans worldwide.',
    'Studies the neural circuits of the zebrafish hindbrain that control eye movements and posture in order to understand how the vertebrate brain integrates sensory signals into motor commands over development.',
    'Studies how chronic inflammation in the gut is driven by signaling between immune cells, epithelial cells, and resident microbes across infection, injury, and inflammatory bowel disease in mice and humans.',
    'Develops machine learning methods for radiology reports and imaging archives that teach clinicians how to recognize early signs of lung disease, cancer, and cardiovascular conditions in routine scans today.',
  ])('does not end a card on a word that needs what follows it: %s', (card) => {
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('does not cut to a head the card quality check would call too short', () => {
    const card =
      'Develops new imaging tools for neurons, including two-photon microscopes, genetically encoded voltage indicators, adaptive optics, and analysis software for recording cortical activity in behaving animals.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('does not cut example lists inside a relative clause or after a placeholder noun', () => {
    const relative =
      'Studies lysosome cell biology in neurodegenerative disease, aiming to define cellular mechanisms that allow specialized cell types such as neurons, microglia and macrophages to meet their physiological demands.';
    expect(shortenCardLineToFitBrowseCard(relative)).toBe(
      'Studies lysosome cell biology in neurodegenerative disease.',
    );
    const placeholder =
      'Studies Latin American film and literature, the reception of classical tragedy in Latin America, and topics including sleep and insomnia, gender debates, Third Cinema, and psychoanalysis in the region.';
    expect(shortenCardLineToFitBrowseCard(placeholder)).toBe(placeholder);
  });

  it('does not end a card on a linking verb', () => {
    const card =
      'The fixture group primary research interests are: identifying mechanisms that contribute to lung injury in preterm infants and protective strategies that may reduce adverse pulmonary outcomes over time.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });

  it('leaves a card that already fits untouched', () => {
    const card = 'Studies how cells divide during early development.';
    expect(shortenCardLineToFitBrowseCard(card)).toBe(card);
  });
});
