import { describe, expect, it } from 'vitest';

import {
  isEducationOrCareerTimelineSentence,
  isProfileBiographyChromeOpener,
  protectedSentenceList,
  repairPersonBiographyLeakedDescription,
  stripProfileBiographyChromeOpener,
  stripTrailingProfileChromeFooter,
} from '../researchEntityBiographyDescriptionRepair';

describe('isEducationOrCareerTimelineSentence', () => {
  it('flags personal-life and education-timeline sentences (#1456)', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Satinder was born in Boston, MA and moved, as a teenager, to Minneapolis, MN, with her family.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'She received her doctoral degree in Biochemistry & Molecular Biophysics from the University of Minnesota.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'Next, he completed his graduate studies on cell cytoskeleton and protein trafficking under the direction of John V. Cox.',
      ),
    ).toBe(true);
  });

  it('does not flag a sentence describing what the lab studies, even if it mentions "studies" as a noun', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Dr. Ghosh and Dr. Carla Rothlin co-direct a lab studying the regulation of inflammation.',
      ),
    ).toBe(false);
  });
});

describe('isProfileBiographyChromeOpener / stripProfileBiographyChromeOpener', () => {
  it('detects and strips a leading "Welcome!" / "Bio:" / "Titles...Biography" opener', () => {
    expect(isProfileBiographyChromeOpener('Welcome! We are part of the Yale School of Medicine.')).toBe(
      true,
    );
    expect(
      stripProfileBiographyChromeOpener('Welcome! We are part of the Yale School of Medicine.'),
    ).toBe('We are part of the Yale School of Medicine.');
    expect(
      stripProfileBiographyChromeOpener(
        'TitlesAssistant Professor of Medicine (General Medicine)BiographyDavid Fink is a social epidemiologist.',
      ),
    ).toBe('David Fink is a social epidemiologist.');
  });

  it('leaves ordinary research prose untouched', () => {
    expect(isProfileBiographyChromeOpener('Studies chromatin dynamics in stem cells.')).toBe(false);
  });
});

describe('stripTrailingProfileChromeFooter', () => {
  it('strips a profile-page "Departments & Organizations" footer glued onto the last sentence', () => {
    expect(
      stripTrailingProfileChromeFooter(
        'He is funded by NIDA to investigate telehealth guidelines.Last Updated on June 02, 2026.Departments & OrganizationsInternal MedicinePhDColumbia University, Epidemiology (2020)',
      ),
    ).toBe('He is funded by NIDA to investigate telehealth guidelines.');
  });
});

describe('protectedSentenceList', () => {
  it('does not drop text around an unspaced abbreviation like "Ph.D studies" (#1456)', () => {
    const sentences = protectedSentenceList(
      'He then came to the U.S. to pursue Ph.D studies with Carl Nathan in the Immunology program.',
    );
    expect(sentences).toEqual([
      'He then came to the U.S. to pursue Ph.D studies with Carl Nathan in the Immunology program.',
    ]);
  });
});

describe('repairPersonBiographyLeakedDescription', () => {
  it('strips a personal-life narrative and keeps the genuine research content (singh-lab-sks4, #1456)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Satinder was born in Boston, MA and moved, as a teenager, to Minneapolis, MN, with her family. She received her doctoral degree in Biochemistry & Molecular Biophysics from the University of Minnesota, supported by an HHMI Predoctoral Fellowship. She has had a long-standing interest in the molecular mechanisms of neuropsychiatric disease. As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
      shortDescription:
        'As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
      researchAreas: [],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).not.toMatch(/was born in/i);
    expect(result.fullDescription).not.toMatch(/received her doctoral degree/i);
    expect(result.fullDescription).toMatch(/long-standing interest/i);
    expect(result.shortDescription).toBe(
      'As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
    );
  });

  it('strips profile chrome (leading + trailing) while keeping a good short description untouched (nih-pi-david-fink, #1456)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'TitlesAssistant Professor of Medicine (General Medicine)BiographyDavid Fink, PhD, MPH is a social epidemiologist whose research applies a multi-level life course perspective, coupled with rigorous causal inference methodologies, to understand the causes of addiction and mental illness and estimate the effects of policies and programs. His research in mental health, substance use, and health policy are united by a desire to understand and address structural, societal, and interpersonal factors that shape health and well-being over the life course. He received his Masters in Public Health in epidemiology and biostatistics from San Diego State University and his PhD from Columbia University where his research focused on understanding the effects of cannabis legalization and prescription drug monitoring programs on drug-related morbidity and mortality. He is currently an assistant professor in Department of Internal Medicine at Yale, where he is funded by NIDA to investigate the effects of more flexible telehealth guidelines for buprenorphine prescribing for opioid use disorder.Last Updated on June 02, 2026.Departments & OrganizationsInternal MedicineJaneway SocietyEducation & TrainingPostdoctoral research fellowNew York State Psychiatric Institute (2025)PhDColumbia University, Epidemiology (2020)',
      shortDescription:
        'Investigates the effects of flexible telehealth guidelines for buprenorphine prescribing on opioid use disorder.',
      researchAreas: ['Substance-Related Disorders', 'Mental Health'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription.startsWith('TitlesAssistant')).toBe(false);
    expect(result.fullDescription).not.toMatch(/Departments\s*&\s*Organizations/);
    expect(result.shortDescription).toBe(
      'Investigates the effects of flexible telehealth guidelines for buprenorphine prescribing on opioid use disorder.',
    );
  });

  it('reports unchanged for a description with no biography/CV/chrome signature', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription: 'Our lab studies how microbes defend themselves against stress at the host-pathogen interface.',
      shortDescription: 'Studies host-pathogen stress response.',
      researchAreas: ['Microbiology'],
    });
    expect(result.outcome).toBe('unchanged');
  });

  it('falls back to a researchAreas card summary when nothing research-focused survives stripping', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Jane Doe was born in Boston, MA. She received her doctoral degree from Harvard University. She completed her postdoctoral training at MIT. She joined the Yale faculty in 2015.',
      shortDescription: 'She received her doctoral degree from Harvard University.',
      researchAreas: ['Cell Biology', 'Genetics'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).toBe('Studies Cell Biology and Genetics.');
    expect(result.shortDescription).toBe('Studies Cell Biology and Genetics.');
  });

  it('blanks the description when nothing usable can be derived at all', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Jane Doe was born in Boston, MA. She received her doctoral degree from Harvard University. She completed her postdoctoral training at MIT. She joined the Yale faculty in 2015.',
      shortDescription: 'She received her doctoral degree from Harvard University.',
      researchAreas: [],
    });
    expect(result.outcome).toBe('blanked');
    expect(result.fullDescription).toBe('');
    expect(result.shortDescription).toBe('');
  });
});
