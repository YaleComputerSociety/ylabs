import { describe, expect, it } from 'vitest';

import { programAudience } from '../programAudience';
import { computeProgramStudentVisibility } from '../studentVisibilityTier';
import { publicProgramForReader } from '../../controllers/programPayload';
import { publicFellowshipForStudent } from '../fellowshipService';

const servedProgram = (overrides: Record<string, unknown> = {}) => ({
  title: 'Example Summer Research Fellowship',
  studentFacingCategory: 'Research funding',
  sourceUrl: 'https://example.yale.edu/programs/summer-research',
  applicationLink: 'https://example.yale.edu/programs/summer-research/apply',
  purpose: ['Research'],
  summary:
    'Funds a summer of faculty-mentored research in the sciences, with a stipend and housing support for the full term.',
  ...overrides,
});

describe('programAudience (#4088)', () => {
  it('reads a program open to both from a year-of-study facet naming both', () => {
    expect(
      programAudience({
        undergraduateOnly: true,
        yearOfStudy: ['Junior', 'Senior', 'Master’s Student', 'PhD Pre-Candidacy'],
      }),
    ).toBe('UNDERGRADUATE_AND_GRADUATE');
  });

  it('lets the facet overrule a stored undergraduate-only claim that lists only graduate years', () => {
    expect(
      programAudience({ undergraduateOnly: true, yearOfStudy: ['JD', 'Grad/Prof Year2'] }),
    ).toBe('GRADUATE');
  });

  it('reads undergraduate-only from undergraduate years alone', () => {
    expect(
      programAudience({
        undergraduateOnly: false,
        yearOfStudy: ['First-Year Student', 'Sophomore'],
      }),
    ).toBe('UNDERGRADUATE');
  });

  it('falls back to the stored booleans when the facet names no class of student', () => {
    expect(programAudience({ undergraduateOnly: true, yearOfStudy: ['Alumni'] })).toBe(
      'UNDERGRADUATE',
    );
    expect(programAudience({ yaleCollegeOnly: true })).toBe('UNDERGRADUATE');
    expect(programAudience({ undergraduateOnly: false })).toBe('GRADUATE');
    expect(programAudience({})).toBeNull();
  });
});

describe('the program gate reads the derived audience', () => {
  it('keeps a program open to both undergraduate-relevant and never marks it graduate', () => {
    const result = computeProgramStudentVisibility(
      servedProgram({ undergraduateOnly: true, yearOfStudy: ['Junior', 'PhD Post-Candidacy'] }),
    );
    expect(result.reasons).toContain('undergraduate_relevant');
    expect(result.reasons).not.toContain('graduate_relevant');
  });

  it('marks a program whose facet lists only graduate years as graduate', () => {
    const result = computeProgramStudentVisibility(
      servedProgram({ undergraduateOnly: true, yearOfStudy: ['MD'] }),
    );
    expect(result.reasons).toContain('graduate_relevant');
    expect(result.reasons).not.toContain('undergraduate_relevant');
  });

  it('knows the audience of a program whose only audience evidence is the facet', () => {
    const result = computeProgramStudentVisibility(servedProgram({ yearOfStudy: ['Senior'] }));
    expect(result.reasons).toContain('undergraduate_relevant');
  });
});

describe('both public program serializers serve the derived audience', () => {
  const row = { _id: '000000000000000000004088', ...servedProgram() };
  const openToBoth = { ...row, undergraduateOnly: true, yearOfStudy: ['Junior', 'JD'] };

  it('serves it on the programs route payload', () => {
    expect(publicProgramForReader(openToBoth).audience).toBe('UNDERGRADUATE_AND_GRADUATE');
  });

  it('serves it on the student fellowship serializer', () => {
    expect(publicFellowshipForStudent(openToBoth).audience).toBe('UNDERGRADUATE_AND_GRADUATE');
  });
});
