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

describe('classifyProgram internship identity (#2925)', () => {
  it('keeps a travel fund whose purpose list merely permits an internship out of the internship category', () => {
    expect(
      classifyProgram({
        title: 'Fixture College Summer Travel Fund',
        description: 'Supports eligible Yale College summer projects abroad.',
        purpose: [
          'Study Abroad',
          'Language Study',
          'Internship/Work Project',
          'Community or Public Service',
          'Research',
        ],
      }),
    ).toMatchObject({
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Research travel funding',
    });
  });

  it('keeps an award that may fund an internship out of the internship category', () => {
    expect(
      classifyProgram({
        title: 'Fixture Stewardship Fellowship',
        description:
          'Provides a financial award and mentorship for research, an internship, or an applied project in conservation.',
      }),
    ).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING', programCategory: 'FELLOWSHIP' });
    expect(
      classifyProgram({
        title: 'Fixture Studies Student Internship and Research Grant',
        summary: 'A small grant supporting eligible student internships or research.',
      }),
    ).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING', programCategory: 'FELLOWSHIP' });
  });

  it('still classifies a record that names itself an internship program', () => {
    expect(classifyProgram({ title: 'Fixture Research Internship Program' })).toMatchObject({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      studentFacingCategory: 'Internship program',
    });
    expect(
      classifyProgram({ title: 'Fixture Economics Summer Research Internship' }),
    ).toMatchObject({ studentFacingCategory: 'Internship program' });
  });

  it('files an internship a department page publishes as a department program, not a center internship (#4089)', () => {
    expect(
      classifyProgram({
        title: 'Fixture Research Internship Program',
        sourceUrl:
          'https://example.yale.edu/academic-study/departments/fixture-studies/undergraduate-study/research-internship-program',
      }),
    ).toMatchObject({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      studentFacingCategory: 'Internship program',
    });
    expect(
      classifyProgram({
        title: 'Fixture Research Internship Program',
        sourceUrl: 'https://fixturecenter.yale.edu/education/research-internship-program',
      }),
    ).toMatchObject({ programCategory: 'CENTER_INTERNSHIP', programKind: 'CENTER_INTERNSHIP' });
  });

  describe('frozen Development misreadings (#3904)', () => {
    it('reads the STARS first-year mentoring program as a way in rather than funding', () => {
      expect(
        classifyProgram({
          title: 'STARS I Academic Year Program',
          description:
            'STARS I is a Yale College academic-year mentoring and support program for first-year students interested in STEM, rather than a direct research placement.',
        }),
      ).toMatchObject({
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'APPLY_TO_PROGRAM',
        requiresMentorBeforeApply: false,
      });
    });

    it('reads the STARS mentoring program from the page wording alone (#4586)', () => {
      expect(
        classifyProgram({
          title: 'STARS I Academic Year Program',
          description:
            'STARS I is a mentoring program that builds a network of support for first-year students interested in STEM.',
        }),
      ).toMatchObject({
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'APPLY_TO_PROGRAM',
        studentFacingCategory: 'STEM mentoring program',
      });
    });

    it('reads the STARS academic-year research program as mentor-first rather than travel funding', () => {
      expect(
        classifyProgram({
          title: 'STARS II Program',
          purpose: ['Research', 'Travel'],
          description:
            'The program supports juniors and seniors who need financial support to conduct research during the academic year.',
        }),
      ).toMatchObject({
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'SECURE_MENTOR_THEN_APPLY',
        requiresMentorBeforeApply: true,
      });
    });

    it('reads the Bouchet fellowship as a cohort program', () => {
      expect(
        classifyProgram({
          title: 'Edward A. Bouchet Undergraduate Fellowship',
          description: 'Fellows work on paid research projects during the academic year.',
        }),
      ).toMatchObject({ programKind: 'STRUCTURED_PROGRAM', mentorMatching: true });
    });

    it('reads senior-essay funding from the prose rather than the title', () => {
      expect(
        classifyProgram({
          title: 'Fixture College Mellon Research Grant',
          description:
            'To provide funding to off-set the costs associated with a senior research project or senior essay.',
        }),
      ).toMatchObject({ programKind: 'SENIOR_THESIS_FUNDING' });
    });

    it('does not read an exclusion of senior essays as senior research funding', () => {
      for (const description of [
        'Supports summer research travel. Funds may not be used for senior essay research.',
        'Supports summer research travel. The grant does not fund senior thesis work.',
      ]) {
        expect(
          classifyProgram({ title: 'Fixture Summer Research Grant', description }),
        ).not.toMatchObject({ programKind: 'SENIOR_THESIS_FUNDING' });
      }
    });

    it('does not read the permitted-use facet as a senior-only audience', () => {
      expect(
        classifyProgram({
          title: 'Fixture Memorial Fellowship',
          purpose: ['Research', 'Senior Research Project or Senior Essay'],
          description:
            'Supports summer independent research in the fine arts for first-year, sophomore and junior students.',
        }),
      ).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING' });
    });

    it('does not read a word ending in "ra" as a research assistant program', () => {
      expect(
        classifyProgram({
          title: 'Sierra College Summer Fellowship',
          description: 'Supports an independent summer research project.',
        }),
      ).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING' });
    });

    it('leaves a page that lists many awards for archive review', () => {
      expect(
        classifyProgram({
          title: 'Undergraduate Grants and Prizes',
          description:
            'The council awards a senior essay prize and funds summer research travel each year.',
        }),
      ).toMatchObject({ programKind: 'OTHER', studentFacingCategory: 'Archive / review' });
    });

    it('does not read travel funding with no research dimension as research travel', () => {
      expect(
        classifyProgram({
          title: 'Fixture Summer Travel Fellowship',
          description: 'Supports summer travel abroad for public service and language study.',
        }),
      ).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING' });
    });

    it('reads a summer scholars program as a structured summer research program', () => {
      expect(
        classifyProgram({
          title: 'Fixture Research Institute Summer Scholars Program',
          description:
            'A 10-week, full-time internship during which participants train under the direct supervision of a mentor.',
        }),
      ).toMatchObject({ programCategory: 'SUMMER_RESEARCH_PROGRAM' });
    });
  });

  describe('program role (#3904)', () => {
    it('reads a page titled as undergraduate research guidance as a way in, not funding', () => {
      expect(
        classifyProgram({
          title: 'Fixture Studies Undergraduate Research Opportunities',
          sourcePageTitle: 'Undergraduate Research Opportunities',
          description:
            'Students interested in research should contact the faculty member directly.',
        }),
      ).toMatchObject({
        programKind: 'DEPARTMENT_RESEARCH_GUIDE',
        programRole: 'STARTS_RESEARCH',
        entryMode: 'CONTACT_FACULTY',
        studentFacingCategory: 'Department research guidance',
      });
    });

    it('does not read a guide from the lane-authored record title alone (#4285)', () => {
      expect(
        classifyProgram({ title: 'Fixture Studies Undergraduate Research Opportunities' })
          .programKind,
      ).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
    });

    it('does not read a general undergraduate program page as a guide (#4285)', () => {
      expect(
        classifyProgram({
          title: 'Fixture Studies Undergraduate Research',
          sourcePageTitle: 'Undergraduate Program',
        }).programKind,
      ).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
    });

    it('does not read a senior essay page as a guide (#4285)', () => {
      expect(
        classifyProgram({
          title: 'Fixture Studies Undergraduate Research',
          sourcePageTitle: 'Senior Project',
        }).programKind,
      ).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
    });

    it('does not read a guidance page that states an application cycle as a guide (#4285)', () => {
      expect(
        classifyProgram({
          title: 'Fixture Studies Undergraduate Research',
          sourcePageTitle: 'Undergraduate Research',
          deadline: new Date('2099-02-01T00:00:00Z'),
        }).programKind,
      ).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
    });

    it('does not read a named summer program as a department guide', () => {
      expect(
        classifyProgram({
          title: 'Fixture Summer Research Opportunities',
          sourcePageTitle: 'Summer Research Opportunities',
        }).programKind,
      ).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
    });

    it('does not read a graduate audience research page as an undergraduate guide', () => {
      const classification = classifyProgram({
        title: 'Graduate Research Opportunities',
        sourcePageTitle: 'Graduate Research Opportunities',
      });
      expect(classification.programKind).not.toBe('DEPARTMENT_RESEARCH_GUIDE');
      expect(classification.undergraduateOnly).not.toBe(true);
    });

    it('asserts an undergraduate audience only when the guide page title names one', () => {
      const classification = classifyProgram({
        title: 'Fixture Sciences Research Opportunities',
        sourcePageTitle: 'Research Opportunities',
      });
      expect(classification.programKind).toBe('DEPARTMENT_RESEARCH_GUIDE');
      expect(classification.undergraduateOnly).toBeUndefined();
    });

    it('reads a scholarship for students pursuing research careers as recognition', () => {
      expect(
        classifyProgram({
          title: 'Fixture National Scholarship',
          purpose: ['Study'],
          description:
            'For sophomores and juniors intending to pursue research careers in STEM fields.',
        }),
      ).toMatchObject({ programKind: 'RESEARCH_AWARD', programRole: 'RECOGNIZES_RESEARCH' });
    });

    it('gives funding kinds the funding role and archive review no role', () => {
      expect(
        classifyProgram({
          title: 'Fixture Research Grant',
          description: 'Supports independent summer research projects.',
        }).programRole,
      ).toBe('FUNDS_RESEARCH');
      expect(classifyProgram({ title: 'Fellowships & Grants' }).programRole).toBe('UNCLASSIFIED');
    });
  });

  it('does not file an award that mentions a faculty mentor as a mentored program', () => {
    const result = classifyProgram({
      title: 'Fixture Center Short-term Research and Travel Award',
      description:
        'Awards of $500 to $2000 support research travel; applicants need a faculty mentor letter.',
    });
    expect(result.programKind).not.toBe('MENTOR_MATCHING');
    expect(result.programRole).toBe('FUNDS_RESEARCH');
  });
});

describe('classifyProgram mentor requirement is read off the page (#4131)', () => {
  const fund = (applicationInformation: string) =>
    classifyProgram({ title: 'Fixture Memorial Fund', applicationInformation });

  it('claims no mentor requirement for a funding record whose page states none', () => {
    expect(fund('Submit a budget and a one-page statement through the database.')).toMatchObject({
      entryMode: 'APPLY_TO_PROGRAM',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'Fellowship or grant',
      prepSteps: ['Eligibility check', 'Official application'],
    });
  });

  it('does not treat a letter of recommendation as a mentor requirement', () => {
    expect(fund('One letter of recommendation from a faculty advisor.')).toMatchObject({
      requiresMentorBeforeApply: false,
    });
    expect(fund('Letter of support from a faculty advisor.')).toMatchObject({
      requiresMentorBeforeApply: false,
    });
  });

  it.each([
    'The letter must include confirmation that this person has agreed to be the mentor for this project.',
    'The Fellow must have a written commitment from a Yale faculty member to conduct research in the laboratory.',
    'In order to receive consideration, a candidate must have as a sponsor a member of the faculty.',
    'All applicants require a school-affiliated mentor.',
    'The signature of the applicant’s thesis advisor is required.',
    'Proposals should include the name of your faculty mentor and a description of their role.',
  ])('claims a mentor requirement the page states: %s', (text) => {
    expect(fund(text)).toMatchObject({
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      requiresMentorBeforeApply: true,
      studentFacingCategory: 'Funding after mentor',
    });
  });

  it.each([
    'Projects may have a faculty advisor or collaborator, but are not required to.',
    'Meeting with an adviser is not mandatory.',
    'A faculty mentor is not required, but applicants are encouraged to consult one.',
  ])('does not claim a requirement the page explicitly waives: %s', (text) => {
    expect(fund(text)).toMatchObject({ requiresMentorBeforeApply: false });
  });

  it('judges each sentence alone, so a waiver elsewhere cannot cancel a stated requirement', () => {
    expect(
      fund(
        'Meeting with a fellowship adviser is not mandatory. All applicants require a faculty mentor.',
      ),
    ).toMatchObject({ requiresMentorBeforeApply: true });
  });

  it('keeps the faculty sponsor prep step on travel funding only when the page requires one', () => {
    const travel = (applicationInformation: string) =>
      classifyProgram({
        title: 'Fixture Travel Research Grant',
        description: 'Supports field research travel abroad.',
        applicationInformation,
      });
    expect(travel('Submit a budget.').prepSteps).not.toContain('Faculty sponsor');
    expect(travel('All applicants require a faculty sponsor.').prepSteps).toContain(
      'Faculty sponsor',
    );
  });

  it('never tells a student to find a research home', () => {
    for (const text of ['Submit a budget.', 'All applicants require a faculty mentor.']) {
      expect(fund(text).bestNextStep).not.toMatch(/research home/i);
    }
  });
});

describe('classifyProgram senior research funding reads its mentor requirement off the page (#4218)', () => {
  it('does not file a college fellowship as senior research because of the college or donor name', () => {
    const richter = classifyProgram({
      title: 'Fixture College Richter Summer Fellowship',
      description:
        'Awarded for independent study and research. First years, sophomores and juniors are eligible.',
    });
    expect(richter.programKind).not.toBe('SENIOR_THESIS_FUNDING');
    expect(richter.requiresMentorBeforeApply).toBe(false);
  });

  it('claims an adviser requirement when the adviser must endorse the project', () => {
    for (const applicationInformation of [
      'Provide a faculty advisor reference stipulating your project/essay.',
      'Applicant will need a faculty adviser reference supporting your project/essay.',
      'Each application must include the approval of a faculty advisor who will supervise the research project.',
    ]) {
      expect(
        classifyProgram({
          title: 'Fixture College Mellon Senior Research Grant',
          applicationInformation,
        }),
      ).toMatchObject({
        programKind: 'SENIOR_THESIS_FUNDING',
        requiresMentorBeforeApply: true,
        entryMode: 'SECURE_MENTOR_THEN_APPLY',
        prepSteps: ['Faculty adviser', 'Senior project plan', 'Budget or proposal'],
      });
    }
  });

  it('claims no requirement for senior research funding whose page states none', () => {
    expect(
      classifyProgram({
        title: 'Fixture Studies Senior Essay Research Grant',
        description: 'Supports travel and research costs for a senior essay.',
      }),
    ).toMatchObject({
      programKind: 'SENIOR_THESIS_FUNDING',
      requiresMentorBeforeApply: false,
      entryMode: 'APPLY_TO_PROGRAM',
      prepSteps: ['Senior project plan', 'Budget or proposal'],
    });
  });

  it.each([
    'All research projects must be supervised by Yale faculty who work with students on the design.',
    'Include support letters from a faculty advisor who has agreed to work with the student.',
    'Include a letter approving the proposed project from a member of the Yale Faculty.',
  ])('reads a supervision requirement: %s', (applicationInformation) => {
    expect(
      classifyProgram({ title: 'Fixture Memorial Fund', applicationInformation })
        .requiresMentorBeforeApply,
    ).toBe(true);
  });

  it('does not read a requirement from a recommendation of the candidate or an unrelated agreement', () => {
    for (const applicationInformation of [
      'One letter of recommendation from a faculty member.',
      'A letter of recommendation from a faculty advisor describing your preparation.',
      'Selected fellows have agreed to work with program staff on a short report.',
    ]) {
      expect(
        classifyProgram({ title: 'Fixture Memorial Fund', applicationInformation })
          .requiresMentorBeforeApply,
      ).toBe(false);
    }
  });
});
