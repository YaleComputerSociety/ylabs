import { describe, expect, it } from 'vitest';
import { classifyProgram } from '../programClassifier';

describe('classifyProgram', () => {
  it('classifies STARS Summer as a structured program that needs a lab commitment first', () => {
    expect(
      classifyProgram({
        title: 'STARS Summer Research Program',
        summary:
          'Students conduct summer research in a Yale lab and need a lab commitment before applying.',
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

  it('does not let a Wu Tsai cross-referral in a record description hijack the record classification', () => {
    const deansRosenfeld = classifyProgram({
      title: "Yale College Dean's Research Fellowship & Rosenfeld Science Scholars Program",
      sourceUrl: 'https://science.yalecollege.yale.edu/deans-research-fellowship',
      description:
        'If you are interested in neuroscience, psychology, computer science, or engineering, please consider applying to the Wu Tsai Undergraduate Fellowships Program instead.',
    });
    expect(deansRosenfeld).toMatchObject({
      programKind: 'FELLOWSHIP_FUNDING',
      studentFacingCategory: 'Funding after mentor',
      yaleCollegeOnly: true,
    });
    expect(deansRosenfeld.mentorMatching).toBe(false);
    expect(deansRosenfeld.bestNextStep).not.toContain('Wu Tsai');
  });

  it('classifies a first-year summer fellowship on its own identity even when it name-drops Wu Tsai', () => {
    const firstYear = classifyProgram({
      title: 'Yale College First-Year Summer Research Fellowship in the Sciences & Engineering',
      sourceUrl: 'https://science.yalecollege.yale.edu/first-year-summer-research-fellowship',
      description:
        'Students interested in neuroscience should also consider the Wu Tsai Undergraduate Fellowships Program.',
    });
    expect(firstYear).toMatchObject({
      programKind: 'FELLOWSHIP_FUNDING',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Funding after mentor',
    });
    expect(firstYear.mentorMatching).toBe(false);
    expect(firstYear.bestNextStep).not.toContain('Wu Tsai');
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

  it('gives a graduate research fellowship an honest funding category instead of archive review', () => {
    expect(
      classifyProgram({
        title: 'Graduate Research Fellowships of the Gilder Lehrman Center',
        summary:
          'This fellowship is for graduate students conducting doctoral dissertation research.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'FELLOWSHIP_FUNDING',
      studentFacingCategory: 'Graduate research funding',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      requiresMentorBeforeApply: true,
    });
  });

  it('classifies a graduate dissertation research award that funds travel as graduate travel funding', () => {
    expect(
      classifyProgram({
        title: 'Grand Strategy Dissertation Research Award',
        summary: 'The award supports research abroad for PhD dissertations.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Graduate research travel funding',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
    });
  });

  it('gives a graduate collections fellowship a direct-apply entry mode', () => {
    expect(
      classifyProgram({
        title: 'Beinecke Library Research Fellowships for Graduate and Professional Students',
        summary:
          'The library awards short-term fellowships supporting on-site research in its collections by graduate and professional students.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'FELLOWSHIP_FUNDING',
      studentFacingCategory: 'Graduate collections research fellowship',
      entryMode: 'APPLY_TO_PROGRAM',
      requiresMentorBeforeApply: false,
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

  it('keeps a graduate travel grant out of the undergraduate internship category', () => {
    expect(
      classifyProgram({
        title: 'Coca-Cola World Fund at Yale',
        summary:
          'Provides summer travel grants for graduate and professional student projects involving applied research or internships overseas.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Graduate research travel funding',
    });
  });

  it('classifies graduate research assistantships as a direct-apply assistantship', () => {
    expect(
      classifyProgram({
        title:
          'Yale University Art Gallery and Yale Center for British Art Graduate Research Assistantships',
        summary:
          'Graduate Research Assistantships are designed to provide Yale University doctoral students with curatorial research experience.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'RA_PROGRAM',
      studentFacingCategory: 'Graduate research assistantship',
      entryMode: 'APPLY_TO_PROGRAM',
    });
  });

  it('gives Graduate School research grants a graduate funding category', () => {
    expect(
      classifyProgram({
        title: 'John F. Enders Fellowships and Research Grants',
        summary:
          'The Graduate School offers competitively awarded fellowships and research grants to qualified students in the Graduate School of Arts & Sciences.',
      }),
    ).toMatchObject({
      undergraduateOnly: false,
      programKind: 'FELLOWSHIP_FUNDING',
      studentFacingCategory: 'Graduate research funding',
    });
  });

  it('keeps a graduate grant with no research signal in archive review', () => {
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

  it('keeps a research grant for researchers outside Yale in archive review', () => {
    expect(
      classifyProgram({
        title: 'The Ferenc Gyorgyey/Stanley Simbonis YSM Research Travel Grant',
        summary:
          'Available to historians, medical practitioners, and other researchers outside of Yale.',
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

  it('classifies an NSF REU requiring a mentor first as SECURE_MENTOR_THEN_APPLY', () => {
    expect(
      classifyProgram({
        title: 'Fixture Astronomy Research Experiences for Undergraduates (REU)',
        competitionType: 'NSF REU (Research Experiences for Undergraduates)',
        description:
          'A ten-week summer research program in astrophysics. Applicants must identify a Yale faculty mentor before applying.',
      }),
    ).toMatchObject({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      requiresMentorBeforeApply: true,
      studentFacingCategory: 'Summer research program (REU)',
      programDates: 'Summer',
    });
  });

  it('classifies a summer research program that matches mentors as DIRECT_FACULTY_MATCHING', () => {
    expect(
      classifyProgram({
        title: 'Summer Undergraduate Math Research at Yale',
        competitionType: 'Summer Undergraduate Research Program',
        description:
          'A nine-week summer program of original research; admitted students are matched with a faculty mentor.',
      }),
    ).toMatchObject({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      mentorMatching: true,
      studentFacingCategory: 'Summer research program (REU)',
    });
  });
});
