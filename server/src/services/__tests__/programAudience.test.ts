import { describe, expect, it } from 'vitest';

import {
  eligibilityAdmitsGraduates,
  programAudience,
  servedUndergraduateOnly,
} from '../programAudience';
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

describe('an eligibility statement that admits graduate students (#6408)', () => {
  const undergraduateYears = ['First-Year Student', 'Sophomore', 'Junior'];

  it('widens an undergraduate audience when the text admits graduate affiliates', () => {
    expect(
      programAudience({
        yearOfStudy: undergraduateYears,
        eligibility:
          'Fixture Fellowships are ordinarily awarded to juniors, but first years, sophomores and graduate affiliates are eligible (seniors are not eligible).',
      }),
    ).toBe('UNDERGRADUATE_AND_GRADUATE');
    expect(
      programAudience({
        undergraduateOnly: true,
        eligibility:
          'Applications from graduate students from the professional schools will also be considered.',
      }),
    ).toBe('UNDERGRADUATE_AND_GRADUATE');
  });

  it('keeps a truly undergraduate-only program undergraduate', () => {
    for (const eligibility of [
      'This fellowship is only open to Yale College undergraduates.',
      'Graduate students are not eligible for this award.',
      'Students who graduate in December are eligible to apply in the summer before their graduation.',
      'Recent graduates are also eligible to apply.',
      'Yale College Postgraduate Fellowships support language study and independent projects.',
      'Applicants need permission of their Director of Graduate Studies.',
    ]) {
      expect(eligibilityAdmitsGraduates(eligibility)).toBe(false);
      expect(programAudience({ yearOfStudy: undergraduateYears, eligibility })).toBe(
        'UNDERGRADUATE',
      );
    }
  });

  it('never reads graduate students named as colleagues, mentors or staff as applicants', () => {
    for (const eligibility of [
      'Undergraduates may apply to work alongside graduate students in the lab.',
      'Graduate students are available to mentor applicants.',
      'Eligible undergraduates will be paired with graduate students.',
      'The program welcomes undergraduates and is run by graduate students.',
      'Applications from undergraduates are reviewed by graduate students.',
    ]) {
      expect(eligibilityAdmitsGraduates(eligibility)).toBe(false);
    }
  });

  it('reads graduate students who may also apply as applicants', () => {
    expect(eligibilityAdmitsGraduates('Graduate and professional students may also apply.')).toBe(
      true,
    );
  });

  it("reads an undergraduate-only phrase that goes on to name master's students as admitting both", () => {
    expect(
      eligibilityAdmitsGraduates(
        "This is only open to Yale undergraduate and master's-level students.",
      ),
    ).toBe(true);
  });

  it('never narrows a graduate audience or invents one with no other evidence', () => {
    const eligibility = 'Graduate students are eligible.';
    expect(programAudience({ yearOfStudy: ['PhD Pre-Candidacy'], eligibility })).toBe('GRADUATE');
    expect(programAudience({ eligibility })).toBeNull();
  });
});

describe('the served undergraduateOnly agrees with the audience (#6400)', () => {
  it('serves false when the audience includes graduate students, whatever is stored', () => {
    const program = servedProgram({
      undergraduateOnly: true,
      yearOfStudy: ['Junior', 'Master’s Student'],
    });
    expect(servedUndergraduateOnly(program as any)).toBe(false);
    expect(publicProgramForReader(program as any)).toMatchObject({
      audience: 'UNDERGRADUATE_AND_GRADUATE',
      undergraduateOnly: false,
    });
    expect(publicFellowshipForStudent(program)).toMatchObject({
      audience: 'UNDERGRADUATE_AND_GRADUATE',
      undergraduateOnly: false,
    });
  });

  it('serves true for an undergraduate audience and null with no audience evidence', () => {
    expect(servedUndergraduateOnly({ yearOfStudy: ['Senior'] })).toBe(true);
    expect(servedUndergraduateOnly({})).toBeNull();
  });
});

describe('a program whose own page text admits students pursuing a graduate degree (#6504)', () => {
  it('widens an undergraduate audience from the stored page text when the row has no eligibility', () => {
    expect(
      programAudience({
        undergraduateOnly: true,
        fullSourceDescription:
          'Fixture Lab runs a summer internship. We welcome applications from all students that are currently pursuing a bachelor, master or PhD degree in Computer Science or related fields.',
      }),
    ).toBe('UNDERGRADUATE_AND_GRADUATE');
    expect(
      eligibilityAdmitsGraduates('Open to students enrolled in a doctoral degree program.'),
    ).toBe(true);
  });

  it('keeps an undergraduate program undergraduate when the page text names a graduate degree otherwise', () => {
    for (const fullSourceDescription of [
      'Undergraduates work alongside students pursuing a PhD degree in the lab.',
      'Applicants should plan to pursue a master or PhD degree after graduation.',
      'Students pursuing a PhD degree are not eligible.',
      'Our mentors are pursuing a doctoral degree.',
      'Open to undergraduates interested in pursuing a PhD degree.',
      'The program welcomes juniors and seniors considering pursuing a master or PhD degree.',
      'Open to rising seniors who plan on pursuing a doctoral degree.',
      'Eligible applicants are undergraduates hoping to start pursuing a PhD degree.',
      'Applications from undergraduates preparing for pursuing a PhD degree are encouraged.',
      'We welcome students from groups underrepresented in fields where few are pursuing a PhD degree.',
      'Open to students interested in pursuing a PhD degree.',
    ]) {
      expect(programAudience({ undergraduateOnly: true, fullSourceDescription })).toBe(
        'UNDERGRADUATE',
      );
    }
  });
});
