import { describe, expect, it } from 'vitest';

import { classifyResearchEntityResearchScope } from '../researchEntityResearchScope';

describe('classifyResearchEntityResearchScope', () => {
  it('leaves non-organizational entities eligible without evaluating narrative evidence', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Example Molecular Dynamics Lab',
      kind: 'lab',
      entityType: 'LAB',
      shortDescription: 'Provides administrative support and academic advising.',
    });

    expect(result.researchHomeEligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('suppresses an instructional-support center without positive research evidence', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Poorvu Center for Teaching and Learning',
      entityType: 'CENTER',
      fullDescription:
        'Supports teaching and learning across the university through consultations, workshops, and educational resources for instructors and students.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toEqual([
      'service_or_instructional_support',
      'missing_positive_research_evidence',
    ]);
  });

  it('suppresses an administrative or service organization without positive research evidence', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Center for Student Services',
      entityType: 'CENTER',
      shortDescription:
        'Coordinates academic advising, career services, and financial aid support for enrolled students.',
      fullDescription:
        'The center manages student affairs, registrar operations, and event planning for the college community.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toEqual([
      'administrative_or_service_organization',
      'missing_positive_research_evidence',
    ]);
  });

  it('detects an administrative signal that only appears in the profile synthesis narrative', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Example Operations Institute',
      kind: 'institute',
      profileSynthesisDescription:
        'Runs facilities management and information technology services for the campus.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toContain('administrative_or_service_organization');
    expect(result.reasons).toContain('missing_positive_research_evidence');
  });

  it('records both negative signals when a unit is administrative and instructional support', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Example Academic Support Office',
      entityType: 'INITIATIVE',
      fullDescription:
        'Provides tutoring and academic advising alongside communications office coordination for the school.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toEqual([
      'service_or_instructional_support',
      'administrative_or_service_organization',
      'missing_positive_research_evidence',
    ]);
  });

  it('keeps an administrative-sounding center that conducts research eligible', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Center for Human Resources Research',
      entityType: 'CENTER',
      fullDescription:
        'Conducts empirical research on human resources and organizational behavior. Its investigators lead research projects and data collection on workforce outcomes.',
    });

    expect(result.researchHomeEligible).toBe(true);
    expect(result.reasons).toEqual(['positive_research_evidence']);
  });

  it('keeps a center that conducts research on teaching in research scope', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Center for Research on Teaching and Learning',
      entityType: 'CENTER',
      fullDescription:
        'Conducts empirical research on university teaching and learning. Its investigators lead research projects, collect data, and publish findings about effective instruction.',
    });

    expect(result.researchHomeEligible).toBe(true);
    expect(result.reasons).toContain('positive_research_evidence');
  });

  it('does not blanket-suppress a research center that lacks any service or administrative signal', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Center for Coastal Systems',
      entityType: 'CENTER',
      fullDescription:
        'Convenes faculty and students for interdisciplinary work on coastal systems, hosting seminars and collaborative projects.',
    });

    expect(result.researchHomeEligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('suppresses an online magazine listed as a center without positive research evidence', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Example Environment 360',
      entityType: 'CENTER',
      fullDescription:
        'An independent online magazine dedicated to environmental journalism. It publishes opinion, analysis, and reporting on global environmental issues to inform and engage the public.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toEqual([
      'publication_or_media_outlet',
      'missing_positive_research_evidence',
    ]);
  });

  it('keeps a communication center that conducts research eligible despite journalism language', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Center for Environmental Communication',
      entityType: 'CENTER',
      fullDescription:
        'Conducts empirical research on environmental communication and journalism. Its investigators lead research projects and collect data on public engagement with climate reporting.',
    });

    expect(result.researchHomeEligible).toBe(true);
    expect(result.reasons).toEqual(['positive_research_evidence']);
  });

  it('applies the negative-evidence rule when the organizational type comes from kind', () => {
    const result = classifyResearchEntityResearchScope({
      name: 'Example Advising Core Facility',
      kind: 'core facility',
      fullDescription: 'Delivers career advising and help desk support to departments.',
    });

    expect(result.researchHomeEligible).toBe(false);
    expect(result.reasons).toContain('administrative_or_service_organization');
  });
});
