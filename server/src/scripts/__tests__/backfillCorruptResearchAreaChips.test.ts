import { describe, expect, it } from 'vitest';

import { planForEntity } from '../backfillCorruptResearchAreaChips';

describe('backfillCorruptResearchAreaChips planForEntity', () => {
  it('strips values the read-time hygiene contract drops to empty', () => {
    const plan = planForEntity('example-lab', 'id-1', [
      'Machine Learning',
      'YSM Researcher',
      'The role of central insulin sensitivity on cognition in prediabetes',
      'We study the physics of condensed matter systems',
    ]);
    expect(plan).not.toBeNull();
    expect(plan?.after).toEqual(['Machine Learning']);
    expect(plan?.removed).toEqual([
      'YSM Researcher',
      'The role of central insulin sensitivity on cognition in prediabetes',
      'We study the physics of condensed matter systems',
    ]);
  });

  it('catches scraper-chrome and label-prefix leaks the corrupt-only gate missed', () => {
    const chrome = planForEntity('chrome-lab', 'id-2', [
      'Drosophila4 YSM ResearchersView 36 Related PublicationsOogenesis2 YSM ResearchersView 27 Related PublicationsActin Cytoskeleton3 YSM ResearchersView 5 Related Publications',
    ]);
    expect(chrome?.after).toEqual([]);

    const fields = planForEntity('econ-faculty', 'id-3', [
      'Fields of Interest Econometrics Financial Economics International Finance International Trade Macroeconomic Models Macroeconomics Political Economy',
    ]);
    expect(fields?.after).toEqual([]);
  });

  it('leaves entities whose areas are all legitimate untouched', () => {
    expect(planForEntity('clean-lab', 'id-4', ['Machine Learning', 'Neuroscience'])).toBeNull();
  });

  it('does not strip legitimate multi-word topic phrases kept by the hygiene contract (#988)', () => {
    expect(
      planForEntity('kept-lab', 'id-5', [
        'Magnetic and transport properties of perovskites and related materials',
        'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
      ]),
    ).toBeNull();
  });
});
