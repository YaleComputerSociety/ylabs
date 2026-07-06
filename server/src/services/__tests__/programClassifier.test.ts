import { describe, expect, it } from 'vitest';
import { classifyProgram } from '../programClassifier';

describe('classifyProgram', () => {
  it('classifies STARS Summer as a structured program that needs a lab commitment first', () => {
    expect(
      classifyProgram({
        title: 'STARS Summer Research Program',
        summary: 'Students conduct summer research in a Yale lab and need a lab commitment before applying.',
      }),
    ).toMatchObject({
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Structured summer program',
      requiresMentorBeforeApply: true,
      mentorMatching: false,
    });
  });

  it('classifies mentor-matching programs separately from generic funding', () => {
    expect(
      classifyProgram({
        title: 'Wu Tsai Undergraduate Fellowships',
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        summary: 'Undergraduates collaborate with faculty mentors in a summer cohort.',
      }),
    ).toMatchObject({
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      mentorMatching: true,
      studentFacingCategory: 'Mentored summer program',
    });
  });

  it('classifies mentor-required funding as funding after mentor fit', () => {
    expect(
      classifyProgram({
        title: 'Yale College First-Year Summer Research Fellowship',
        summary: 'Requires a faculty mentor letter and a student research proposal.',
      }),
    ).toMatchObject({
      programKind: 'FELLOWSHIP_FUNDING',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Funding after mentor',
      requiresMentorBeforeApply: true,
    });
  });

  it('places graduate-only records into archive review classification', () => {
    expect(
      classifyProgram({
        title: 'Graduate Research Fellowships of the Gilder Lehrman Center',
        summary: 'This fellowship is for graduate students conducting doctoral dissertation research.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('uses graduate and dissertation titles as suppression evidence before generic research funding', () => {
    expect(
      classifyProgram({
        title: 'Grand Strategy Dissertation Research Award',
        summary: 'The award supports research abroad for PhD dissertations.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('keeps law school graduate fellowships out of undergraduate program browse', () => {
    expect(
      classifyProgram({
        title: 'Heyman Federal Public Service Fellowship Program - Yale Law School',
        summary: 'The fellowship supports YLS graduates entering federal public service.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('treats postgraduate study awards as archive review records', () => {
    expect(
      classifyProgram({
        title: 'Global Rhodes Scholarship',
        summary: 'The Rhodes Scholarships fund postgraduate study at the University of Oxford.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('does not let internship wording override graduate-only audience evidence', () => {
    expect(
      classifyProgram({
        title: 'Coca-Cola World Fund at Yale',
        summary:
          'Provides summer travel grants for graduate and professional student projects involving applied research or internships overseas.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('keeps graduate research assistantships out of undergraduate public programs', () => {
    expect(
      classifyProgram({
        title:
          'Yale University Art Gallery and Yale Center for British Art Graduate Research Assistantships',
        summary:
          'Graduate Research Assistantships are designed to provide Yale University doctoral students with curatorial research experience.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('suppresses Graduate School research grants without undergraduate audience evidence', () => {
    expect(
      classifyProgram({
        title: 'John F. Enders Fellowships and Research Grants',
        summary:
          'The Graduate School offers competitively awarded fellowships and research grants to qualified students in the Graduate School of Arts & Sciences.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('suppresses masters and PhD student research grants without undergraduate audience evidence', () => {
    expect(
      classifyProgram({
        title: 'Yale Institute for Biospheric Studies Early Grant',
        summary: 'This grant is for masters students and early career PhD students.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('suppresses outside-Yale researcher grants from undergraduate browse', () => {
    expect(
      classifyProgram({
        title: 'The Ferenc Gyorgyey/Stanley Simbonis YSM Research Travel Grant',
        summary: 'Available to historians, medical practitioners, and other researchers outside of Yale.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('treats postgraduate common application rows as archive review records', () => {
    expect(
      classifyProgram({
        title: 'Yale College Postgraduate Fellowships Common Application',
      }),
    ).toMatchObject({
      programKind: 'OTHER',
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });

  it('keeps law-school common applications that say not for undergraduates hidden', () => {
    expect(
      classifyProgram({
        title: 'Law School Fellowships Common Application',
        summary:
          'This application is not for undergraduates. Undergraduates should apply to the Liman Summer Fellowship for Yale Undergraduates.',
      }),
    ).toMatchObject({
      programKind: 'OTHER',
      undergraduateOnly: false,
      studentFacingCategory: 'Archive / review',
      entryMode: 'TRACK_NEXT_CYCLE',
    });
  });
});
