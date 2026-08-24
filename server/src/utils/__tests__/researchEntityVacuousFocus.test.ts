import { describe, expect, it } from 'vitest';

import {
  buildResearchAreasCardSummary,
  isVacuousGenericFocusSummary,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const GENUINE_FULL =
  'The lab develops statistical methods for the design and analysis of clinical trials, with applications in oncology and public health.';

describe('isVacuousGenericFocusSummary', () => {
  it('flags a bare verb + article + generic head noun', () => {
    expect(isVacuousGenericFocusSummary('Studies the field.')).toBe(true);
    expect(isVacuousGenericFocusSummary('Studies the organism.')).toBe(true);
    expect(isVacuousGenericFocusSummary('Investigates the system')).toBe(true);
    expect(isVacuousGenericFocusSummary('Focuses on the area.')).toBe(true);
  });

  it('does not flag a specific topic that merely ends in a generic word', () => {
    expect(isVacuousGenericFocusSummary('Studies the immune system.')).toBe(false);
    expect(isVacuousGenericFocusSummary('Studies the nervous system.')).toBe(false);
    expect(isVacuousGenericFocusSummary('Studies the field of genomics.')).toBe(false);
    expect(isVacuousGenericFocusSummary('Studies the brain.')).toBe(false);
    expect(isVacuousGenericFocusSummary('Studies music theory.')).toBe(false);
    expect(isVacuousGenericFocusSummary('Studies liver diseases.')).toBe(false);
  });

  it('ignores non-string input', () => {
    expect(isVacuousGenericFocusSummary(undefined)).toBe(false);
    expect(isVacuousGenericFocusSummary(42)).toBe(false);
  });
});

describe('shortDescriptionQuality with a vacuous generic focus', () => {
  it('treats "Studies the field." as not useful even though it is short and concise', () => {
    const quality = shortDescriptionQuality('Studies the field.', GENUINE_FULL);
    expect(quality.isUseful).toBe(false);
    expect(quality.flags).toContain('generic-lead');
  });

  it('keeps a genuinely specific concise summary useful', () => {
    const quality = shortDescriptionQuality(
      'Studies statistical methods for clinical trials in oncology.',
      GENUINE_FULL,
    );
    expect(quality.isUseful).toBe(true);
  });
});

describe('buildResearchAreasCardSummary', () => {
  it('builds an oxford-joined card from clean research areas', () => {
    expect(
      buildResearchAreasCardSummary([
        'Biostatistics',
        'Public Health',
        'Cancer Research',
        'Clinical Trials',
      ]),
    ).toBe('Studies Biostatistics, Public Health, Cancer Research, and Clinical Trials.');
  });

  it('caps at four topics and dedupes case-insensitively', () => {
    expect(
      buildResearchAreasCardSummary([
        'Neuroscience',
        'neuroscience',
        'Psychology',
        'Genomics',
        'Immunology',
        'Ecology',
      ]),
    ).toBe('Studies Neuroscience, Psychology, Genomics, and Immunology.');
  });

  it('handles a single topic', () => {
    expect(buildResearchAreasCardSummary(['Physics'])).toBe('Studies Physics.');
  });

  it('drops run-on / non-topic entries and fails closed when nothing clean remains', () => {
    expect(
      buildResearchAreasCardSummary([
        'I have been applying techniques drawn from probability theory and statistics',
      ]),
    ).toBe('');
    expect(buildResearchAreasCardSummary([])).toBe('');
    expect(buildResearchAreasCardSummary(undefined)).toBe('');
  });

  it('rejects URL topics so a dirty source list cannot reintroduce a leaked link (#1079)', () => {
    expect(
      buildResearchAreasCardSummary([
        'https://www.ncbi.nlm.nih.gov/myncbi/hong-bo.zhao.1/bibliography/public/',
        'Hearing',
        'Cochlea',
      ]),
    ).toBe('Studies Hearing and Cochlea.');
    expect(buildResearchAreasCardSummary(['www.example.org', 'Genetics'])).toBe(
      'Studies Genetics.',
    );
  });

  it('drops a leaked role-track token so it never rides along as a topic (#1398)', () => {
    expect(
      buildResearchAreasCardSummary([
        'Condensed Matter Physics',
        'Theorist',
        'Stochastic Processes',
      ]),
    ).toBe('Studies Condensed Matter Physics and Stochastic Processes.');
    expect(buildResearchAreasCardSummary(['Astrophysics', 'Experimentalist'])).toBe(
      'Studies Astrophysics.',
    );
  });

  it('collapses a doubled leading verb when a topic already starts with one (#1398)', () => {
    expect(
      buildResearchAreasCardSummary(['Studies on Chitinases and Chitosanases', 'Lung Cancer']),
    ).toBe('Studies on Chitinases and Chitosanases and Lung Cancer.');
  });
});
