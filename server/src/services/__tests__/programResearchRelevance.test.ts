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

  describe('a sentence that denies faculty mentorship (#4246)', () => {
    const internship = (sentence: string, purpose: string[]) =>
      classifyProgramResearchRelevance({
        title: 'Fixture Department Summer Internship',
        programKind: 'STRUCTURED_PROGRAM',
        purpose,
        description: `Paid office internship. ${sentence}`,
      });

    it.each([
      'No faculty mentor is required.',
      'Students do not need a faculty mentor to apply.',
      'This internship is not a faculty mentorship program.',
      'A faculty mentor is not provided.',
    ])('does not admit a program whose page says "%s"', (sentence) => {
      for (const purpose of [['Internship'], []]) {
        const result = internship(sentence, purpose);
        expect(result.researchRelated).toBe(false);
        expect(result.reasons).not.toContain('mentored_research_pathway');
      }
    });

    it('still admits a program that pairs students with a faculty mentor', () => {
      expect(
        internship('Students without prior experience work with a faculty mentor.', ['Internship'])
          .reasons,
      ).toContain('mentored_research_pathway');
      expect(
        internship('Each fellow is paired with a faculty mentor, not a graduate student.', [])
          .reasons,
      ).toContain('mentored_research_pathway');
    });

    it.each([
      'Each fellow works with a faculty mentor who is not affiliated with the sponsor.',
      'Fellows meet weekly with a faculty mentor and prior experience is not required.',
      'No faculty mentor is required to apply, though admitted fellows are matched with a faculty mentor.',
    ])('still admits a program whose negation qualifies something else: "%s"', (sentence) => {
      expect(internship(sentence, ['Internship']).reasons).toContain('mentored_research_pathway');
    });
  });

  it('admits a structured program built on faculty mentorship whose page never says research', () => {
    const pathway = {
      title: 'Fixture Academic Year Program',
      programKind: 'STRUCTURED_PROGRAM',
      purpose: [],
      summary: 'A mentoring and support program for first-year students interested in STEM.',
      description: 'The program builds a network of faculty and peer mentorship.',
    };
    expect(classifyProgramResearchRelevance(pathway)).toEqual({
      researchRelated: true,
      reasons: ['mentored_research_pathway'],
    });
    expect(
      classifyProgramResearchRelevance({ ...pathway, programKind: 'CENTER_INTERNSHIP' })
        .researchRelated,
    ).toBe(false);
    expect(
      classifyProgramResearchRelevance({
        ...pathway,
        description: 'The program builds a network of peer advising.',
      }).researchRelated,
    ).toBe(false);
  });

  describe('the purpose facet decides for a record that carries one (#3904)', () => {
    const related = (input: Parameters<typeof classifyProgramResearchRelevance>[0]) =>
      classifyProgramResearchRelevance(input).researchRelated;

    it('excludes a study, service or internship award whose facet names no research', () => {
      expect(
        related({
          title: 'Fixture Fellowship for Nonprofit Internships',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          studentFacingCategory: 'Research travel funding',
          purpose: ['Service'],
          description: 'Awards support domestic non-profit internships over the summer.',
        }),
      ).toBe(false);
    });

    it('never counts the derived category label as research evidence', () => {
      expect(
        related({
          title: 'Fixture Summer Grant',
          studentFacingCategory: 'Research travel funding',
          purpose: ['Study'],
          description: 'Limited summer funding for language and area study.',
        }),
      ).toBe(false);
    });

    it('keeps a travel award whose own prose says it funds research trips', () => {
      expect(
        related({
          title: 'Fixture Council Travel Award',
          purpose: ['Travel'],
          description:
            'Helps defray travel costs for short-term research trips relating to Europe.',
        }),
      ).toBe(true);
    });

    it('keeps an award whose own title names research', () => {
      expect(
        related({ title: 'Fixture Pre-Dissertation Research Fellowship', purpose: ['Travel'] }),
      ).toBe(true);
    });

    it('keeps a national award for students pursuing research careers', () => {
      expect(
        related({
          title: 'Fixture National Scholarship',
          purpose: ['Study'],
          description:
            'For sophomores and juniors intending to pursue research careers in STEM fields.',
        }),
      ).toBe(true);
    });

    it('does not read funding for non-research projects as funding research', () => {
      expect(
        related({
          title: 'Fixture Service Award',
          purpose: ['Service'],
          description: 'Provides funding for non-research projects in local communities.',
        }),
      ).toBe(false);
    });

    it('does not read research named beside another purpose as funding research', () => {
      expect(
        related({
          title: 'Fixture Language Grant',
          purpose: ['Study'],
          description: 'Grants support language immersion or research abroad.',
        }),
      ).toBe(false);
      expect(
        related({
          title: 'Fixture Summer Award',
          purpose: ['Travel'],
          description: 'Supports students interested in research opportunities overseas.',
        }),
      ).toBe(false);
    });

    it('still keeps an award whose prose says it supports research directly', () => {
      expect(
        related({
          title: 'Fixture Council Grant',
          purpose: ['Travel'],
          description: 'Grants support undergraduate research in the region.',
        }),
      ).toBe(true);
    });

    it('keeps a structured program built on faculty mentorship whatever its facet says', () => {
      expect(
        related({
          title: 'Fixture Academic Year Program',
          programKind: 'STRUCTURED_PROGRAM',
          purpose: ['Study'],
          description:
            'A first-year mentoring program in STEM built on faculty and peer mentorship.',
        }),
      ).toBe(true);
    });

    it('no longer exempts a program by its STARS name or URL alone', () => {
      expect(
        related({
          title: 'Fixture Academic Year Program',
          sourceUrl: 'https://example.edu/stars/fixture-program',
          purpose: ['Study'],
          description: 'A peer advising program for first-year students.',
        }),
      ).toBe(false);
    });

    it('does not let a sentence that disclaims research rescue a non-research facet', () => {
      const practicum = {
        title: 'Fixture Practicum Fellowship',
        purpose: ['Study'],
        description: 'Supports students pursuing in-person internships and practicums.',
        eligibility:
          'Although research may be part of an internship, the fund is not meant to support independent or archival research projects.',
      };
      expect(classifyProgramResearchRelevance(practicum)).toMatchObject({
        researchRelated: false,
        reasons: expect.arrayContaining(['purpose_not_research']),
      });
      expect(
        related({
          ...practicum,
          eligibility: 'The fund is meant to support independent or archival research projects.',
        }),
      ).toBe(true);
      expect(
        related({
          title: 'Fixture National Scholarship',
          purpose: ['Study'],
          description:
            'Not limited to one major. For students intending to pursue research careers.',
        }),
      ).toBe(true);
    });

    it('reads a negation only within the field and clause that hold the rescue', () => {
      const award = { title: 'Fixture Fund', purpose: ['Study', 'Travel'] };
      expect(
        related({
          ...award,
          summary: 'Not restricted to any major',
          description: 'Supports research projects abroad.',
        }),
      ).toBe(true);
      expect(
        related({
          ...award,
          eligibility:
            'Students who have not yet graduated may use the grant to conduct research abroad.',
        }),
      ).toBe(true);
      expect(
        related({
          ...award,
          eligibility:
            'Open to any major, with no citizenship requirement, to support independent research projects.',
        }),
      ).toBe(true);
      expect(
        related({ ...award, eligibility: 'The grant cannot be used to conduct research abroad.' }),
      ).toBe(false);
    });

    it('treats a facet that names only language study like a language-study title', () => {
      const languageProgram = {
        title: 'Fixture Fields Program',
        programKind: 'TRAVEL_RESEARCH_GRANT',
        purpose: ['Language Study'],
        summary: 'Advanced discipline-specific language study that can support research.',
      };
      expect(classifyProgramResearchRelevance(languageProgram)).toMatchObject({
        researchRelated: false,
        reasons: expect.arrayContaining(['language_study_purpose']),
      });
      expect(related({ ...languageProgram, purpose: ['Language Study', 'Research'] })).toBe(true);
      expect(related({ ...languageProgram, programKind: 'SENIOR_THESIS_FUNDING' })).toBe(true);
    });

    it('does not let a kind derived from travel wording exempt a non-research title', () => {
      expect(
        related({
          title: 'Fixture Academic Year Fellowships for Language Study',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          purpose: ['Study Abroad'],
          description: 'Fellowships for students whose research plans require a language.',
        }),
      ).toBe(false);
    });

    it('needs research wording behind a Research purpose that a lane inferred from prose', () => {
      const prize = {
        title: 'Fixture Leadership Prize',
        sourceName: 'yale-college-fellowships-office',
        programKind: 'TRAVEL_RESEARCH_GRANT',
        studentFacingCategory: 'Research travel funding',
        purpose: ['Research', 'Study', 'Travel', 'Service'],
        description: 'Awarded to graduating seniors for exemplary leadership on campus.',
      };
      expect(classifyProgramResearchRelevance(prize)).toMatchObject({
        researchRelated: false,
        reasons: expect.arrayContaining(['inferred_research_purpose_unbacked']),
      });
      expect(
        related({ ...prize, description: 'Supports a summer of independent research abroad.' }),
      ).toBe(true);
      expect(related({ ...prize, description: '' })).toBe(true);
      expect(related({ ...prize, sourceName: 'student-grants-database' })).toBe(true);
    });

    it('leaves a record with no facet to the existing text rule', () => {
      expect(
        related({
          title: 'Fixture Fund',
          purpose: [],
          description: 'Supports independent research projects.',
        }),
      ).toBe(true);
    });
    describe('a multi-purpose fund whose own page names research as an eligible use (#4675)', () => {
      const related = (input: Parameters<typeof classifyProgramResearchRelevance>[0]) =>
        classifyProgramResearchRelevance(input).researchRelated;
      const languageAndResearchGrant = {
        title: 'Fixture Summer Language Study Grant',
        programKind: 'FELLOWSHIP_FUNDING',
        purpose: ['Language Study', 'Research'],
        description:
          'Awards are available to undergraduate and graduate students for language study and research. The award may be used for travel, tuition and other legitimate research expenses.',
      };

      it('serves a language-study titled grant whose description names research as a use', () => {
        expect(classifyProgramResearchRelevance(languageAndResearchGrant)).toMatchObject({
          researchRelated: true,
          reasons: expect.arrayContaining(['non_research_title', 'research_use_stated']),
        });
      });

      it('serves a fund whose facet names only language study when its text names a research use', () => {
        expect(
          related({
            title: 'Fixture Regional Fund',
            purpose: ['Language Study'],
            eligibility: 'Students may use the grant for language study, travel, or research.',
          }),
        ).toBe(true);
      });

      it('withholds a multi-purpose fund whose only research evidence is the purpose tag', () => {
        expect(
          related({
            ...languageAndResearchGrant,
            description: 'Supports intensive language study abroad over the summer.',
          }),
        ).toBe(false);
        expect(
          related({
            title: 'Fixture Regional Fund',
            purpose: ['Language Study'],
            description: 'Supports intensive language study abroad over the summer.',
          }),
        ).toBe(false);
      });

      it('does not count research named as an outcome or an applicant interest as a use', () => {
        expect(
          related({
            ...languageAndResearchGrant,
            description: 'Advanced language study that can support research.',
          }),
        ).toBe(false);
        expect(
          related({
            ...languageAndResearchGrant,
            description: 'Open to students whose work or research involves the region.',
          }),
        ).toBe(false);
        expect(
          related({
            ...languageAndResearchGrant,
            description: 'Priority for students with prior research experience in the language.',
          }),
        ).toBe(false);
      });

      it('keeps a fund withheld when its text negates or disclaims the research use', () => {
        expect(
          related({
            ...languageAndResearchGrant,
            description:
              'Supports language study abroad. The award may not be used for research expenses.',
          }),
        ).toBe(false);
        expect(
          related({
            title: 'Fixture Awards for Internships or Non-Research Projects',
            purpose: ['Internship/Work', 'Research'],
            description: 'Funds internships and project travel, including research travel.',
          }),
        ).toBe(false);
        expect(
          related({
            ...languageAndResearchGrant,
            description:
              'Funds language study and non-research projects. It may be used for travel or research.',
          }),
        ).toBe(false);
      });
    });
  });
});
