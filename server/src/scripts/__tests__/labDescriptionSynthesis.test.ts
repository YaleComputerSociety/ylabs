import { describe, expect, it } from 'vitest';

import {
  assembleSynthesisSourceText,
  evaluateSynthesisOutput,
  isPersonResearchEntityType,
  isSynthesisCandidate,
  projectSynthesisCost,
  synthesisGroundingScore,
  synthesisSystemPromptFor,
} from '../labDescriptionSynthesis';

const genuineFull =
  'Studies zebrafish neural circuits and how they guide behavior. The group uses live imaging and genetic tools to map circuit function.';

const stubFull =
  'Research fields include Quantum Optics, Atomic Interactions, and Molecular Spectroscopy.';

const labSource =
  'The lab studies how neural circuits in zebrafish encode navigation, using two-photon imaging, optogenetics, and behavioral assays to map circuit dynamics during active movement.';

describe('isSynthesisCandidate', () => {
  it('selects entities whose full is a templated stub', () => {
    expect(isSynthesisCandidate({ fullDescription: stubFull, shortDescription: '' })).toBe(true);
  });

  it('selects entities whose short equals the full', () => {
    expect(
      isSynthesisCandidate({ fullDescription: genuineFull, shortDescription: genuineFull }),
    ).toBe(true);
  });

  it('skips entities with genuine full and a distinct short', () => {
    expect(
      isSynthesisCandidate({
        fullDescription: genuineFull,
        shortDescription: 'Investigates how larval circuits steer navigation in open water.',
      }),
    ).toBe(false);
  });
});

describe('synthesisSystemPromptFor', () => {
  it('classifies person and home entity types', () => {
    expect(isPersonResearchEntityType('FACULTY_RESEARCH_AREA')).toBe(true);
    expect(isPersonResearchEntityType('faculty_project')).toBe(true);
    expect(isPersonResearchEntityType('INDIVIDUAL_RESEARCH')).toBe(true);
    expect(isPersonResearchEntityType('LAB')).toBe(false);
    expect(isPersonResearchEntityType('CENTER')).toBe(false);
    expect(isPersonResearchEntityType(undefined)).toBe(false);
  });

  it('directs person entities to describe the researcher, not the lab', () => {
    const prompt = synthesisSystemPromptFor('FACULTY_RESEARCH_AREA');
    expect(prompt).toContain('individual Yale');
    expect(prompt).toContain('THIS researcher');
    expect(prompt).not.toContain('research HOME');
    expect(prompt).not.toContain("principal investigator's personal biography");
  });

  it('directs home entities to describe the research home', () => {
    const prompt = synthesisSystemPromptFor('LAB');
    expect(prompt).toContain('research HOME');
    expect(prompt).not.toContain('THIS researcher');
  });

  it('differs by entity type and keeps the shared CV-drop guardrail', () => {
    const personPrompt = synthesisSystemPromptFor('INDIVIDUAL_RESEARCH');
    const homePrompt = synthesisSystemPromptFor('CENTER');
    expect(personPrompt).not.toEqual(homePrompt);
    for (const prompt of [personPrompt, homePrompt]) {
      expect(prompt).toContain('Do NOT include degrees, titles, appointments');
      expect(prompt).toContain('Use ONLY facts present in the SOURCE text');
    }
  });
});

describe('assembleSynthesisSourceText', () => {
  it('joins distinct stored prose and strips leaked caveats/artifacts', () => {
    const text = assembleSynthesisSourceText({
      fullDescription:
        'Studies coastal erosion. This profile-derived summary should be checked against the linked official sources before outreach.',
      description: 'Studies coastal erosion.',
      profileSynthesisDescription:
        'Uses sediment cores https://example.org/data to reconstruct shorelines.',
    });
    expect(text).not.toContain('before outreach');
    expect(text).not.toContain('http');
    expect(text).toContain('Studies coastal erosion.');
    expect(text).toContain('sediment cores');
  });
});

describe('evaluateSynthesisOutput', () => {
  it('accepts grounded, genuine, lab-focused output', () => {
    const verdict = evaluateSynthesisOutput(
      {
        fullDescription:
          'Studies how zebrafish neural circuits encode navigation, using two-photon imaging and optogenetics to map circuit dynamics during movement.',
        shortDescription:
          'Maps how zebrafish neural circuits encode navigation using two-photon imaging.',
      },
      labSource,
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.grounding).toBeGreaterThanOrEqual(0.5);
  });

  it('rejects ungrounded output that invents content', () => {
    const verdict = evaluateSynthesisOutput(
      {
        fullDescription:
          'Studies quantum gravity, black hole thermodynamics, and cosmological inflation using particle accelerators.',
        shortDescription: 'Investigates quantum gravity and cosmological inflation experiments.',
      },
      labSource,
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('ungrounded');
  });

  it('rejects output that regenerates a keyword stub', () => {
    const verdict = evaluateSynthesisOutput(
      {
        fullDescription: 'Research fields include neural circuits, imaging, and behavior.',
        shortDescription: 'Studies neural circuits, imaging, and behavior in zebrafish models.',
      },
      labSource,
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('not-lab-focused');
  });

  it('rejects empty output', () => {
    const verdict = evaluateSynthesisOutput(
      { fullDescription: '', shortDescription: '' },
      labSource,
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('empty-output');
  });
});

describe('synthesisGroundingScore', () => {
  it('scores higher when output words appear in the source', () => {
    expect(synthesisGroundingScore('zebrafish navigation circuits', labSource)).toBeGreaterThan(
      0.5,
    );
    expect(synthesisGroundingScore('galaxies telescopes asteroids', labSource)).toBe(0);
  });
});

describe('projectSynthesisCost', () => {
  it('projects cost from average token usage', () => {
    const cost = projectSynthesisCost(20000, 4000, 20, 2500);
    expect(cost.avgPromptTokens).toBe(1000);
    expect(cost.avgCompletionTokens).toBe(200);
    expect(cost.projectedUsd).toBeGreaterThan(0);
    expect(cost.sampleUsd).toBeGreaterThan(0);
  });
});
