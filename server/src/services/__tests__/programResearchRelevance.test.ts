import { describe, expect, it } from 'vitest';
import { classifyProgramResearchRelevance } from '../programResearchRelevance';

describe('classifyProgramResearchRelevance', () => {
  it('treats a dedicated research purpose tag as research-related', () => {
    const result = classifyProgramResearchRelevance({
      title: 'Dean’s Research Fellowship',
      purpose: ['Research'],
    });
    expect(result.researchRelated).toBe(true);
    expect(result.reasons).toContain('research_purpose');
  });

  it('treats a research program kind as research-related even without research text', () => {
    const result = classifyProgramResearchRelevance({
      title: 'Tobin RA',
      programKind: 'RA_PROGRAM',
    });
    expect(result.researchRelated).toBe(true);
    expect(result.reasons).toContain('research_program_kind');
  });

  it('detects research relevance from free-text (thesis, dissertation, lab work)', () => {
    expect(
      classifyProgramResearchRelevance({
        title: 'Mellon Senior Forum',
        summary: 'Supports senior essay and thesis research in a faculty-mentored setting.',
      }).researchRelated,
    ).toBe(true);

    expect(
      classifyProgramResearchRelevance({
        title: 'Field Study Grant',
        description: 'Funds independent fieldwork and laboratory research abroad.',
      }).researchRelated,
    ).toBe(true);
  });

  it('rejects programs with no research dimension at all', () => {
    const result = classifyProgramResearchRelevance({
      title: 'Alternative Funding Options',
      summary: 'A directory of general funding sources for students.',
    });
    expect(result.researchRelated).toBe(false);
    expect(result.reasons).toContain('no_research_signal');
  });

  it('rejects a non-research title even when an incidental Research purpose tag is attached', () => {
    const result = classifyProgramResearchRelevance({
      title: 'Summer Journalism Fellowship',
      purpose: ['Research'],
      summary: 'Supports student journalism and reporting projects.',
    });
    expect(result.researchRelated).toBe(false);
    expect(result.reasons).toContain('non_research_title');
  });

  it('keeps a non-research-titled program when its program kind is a dedicated research kind', () => {
    // A strong research kind overrides a non-research title marker.
    const result = classifyProgramResearchRelevance({
      title: 'Public Service Research Assistantship',
      programKind: 'RA_PROGRAM',
    });
    expect(result.researchRelated).toBe(true);
    expect(result.reasons).toContain('research_program_kind');
  });

  it('treats senior thesis / dissertation purpose tags as research-related', () => {
    expect(
      classifyProgramResearchRelevance({
        title: 'Richter Summer Fellowship',
        purpose: ['Senior Research Project or Senior Essay'],
      }).researchRelated,
    ).toBe(true);
    expect(
      classifyProgramResearchRelevance({
        title: 'Dissertation Support Grant',
        purpose: ['Dissertation Support'],
      }).researchRelated,
    ).toBe(true);
  });

  it('ignores non-string fields without throwing', () => {
    const result = classifyProgramResearchRelevance({
      title: undefined,
      purpose: undefined,
      summary: undefined,
    });
    expect(result.researchRelated).toBe(false);
  });
});
