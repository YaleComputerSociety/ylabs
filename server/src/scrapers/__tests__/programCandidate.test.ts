import { describe, expect, it } from 'vitest';
import {
  buildProgramSourceKey,
  candidateToProgramObservations,
  finalizeProgramCandidate,
  inferProgramAccessRole,
  parseProgramDeadlineToUtcEndOfDay,
} from '../programCandidate';

describe('programCandidate', () => {
  it('builds stable source keys from source name and title', () => {
    expect(buildProgramSourceKey('official-yale-programs', 'Wu Tsai Undergraduate Fellowship')).toBe(
      'official-yale-programs:wu-tsai-undergraduate-fellowship',
    );
  });

  it('parses exact Month Day Year deadlines and rejects fuzzy cycle text', () => {
    expect(
      parseProgramDeadlineToUtcEndOfDay(
        'Applications are due Monday, February 9, 2026 at 5:00pm.',
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toEqual(new Date('2026-02-09T23:59:59.999Z'));
    expect(
      parseProgramDeadlineToUtcEndOfDay(
        'The deadline is usually in early February.',
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toBeUndefined();
  });

  it('classifies mentor-matching and internship programs as structured entry', () => {
    expect(
      inferProgramAccessRole(
        'Undergraduate Fellowship',
        'Students are matched with Yale faculty mentors for a summer research project.',
      ),
    ).toBe('MENTOR_MATCHING');
    expect(
      inferProgramAccessRole(
        'Museum Internship Program',
        'Paid summer internships place students in collections research projects.',
      ),
    ).toBe('HOSTED_INTERNSHIP');
  });

  it('keeps general grants as funding-only', () => {
    expect(
      inferProgramAccessRole(
        'Dean’s Research Fellowship',
        'Provides funding for student-designed research with a faculty adviser.',
      ),
    ).toBe('FUNDING_ONLY');
  });

  it('emits fellowship observations with access-role metadata', () => {
    const candidate = finalizeProgramCandidate({
      sourceName: 'official-yale-programs',
      title: 'Wu Tsai Undergraduate Fellowship',
      sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      summary: 'Students work with faculty mentors.',
      description: 'Students are matched with Yale faculty mentors for summer research.',
      applicationLink: 'https://wti.yale.edu/apply',
      links: [{ label: 'Apply', url: 'https://wti.yale.edu/apply' }],
      deadline: new Date('2026-02-09T23:59:59.999Z'),
      applicationOpenDate: undefined,
      contactOffice: 'Wu Tsai Institute',
      contactEmail: undefined,
      yearOfStudy: [],
      termOfAward: ['Summer'],
      purpose: ['Research'],
      globalRegions: [],
      citizenshipStatus: [],
      isAcceptingApplications: true,
      reviewRequired: false,
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programAccessRole: 'MENTOR_MATCHING',
      hostedByResearchEntityName: 'Wu Tsai Institute',
      hostedByResearchEntityUrl: 'https://wti.yale.edu',
    });

    expect(candidate.sourceKey).toBe('official-yale-programs:wu-tsai-undergraduate-fellowship');
    expect(candidate.sourceFingerprint).toHaveLength(64);
    expect(candidateToProgramObservations(candidate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'fellowship', field: 'programAccessRole', value: 'MENTOR_MATCHING' }),
        expect.objectContaining({
          entityType: 'fellowship',
          field: 'hostedByResearchEntityName',
          value: 'Wu Tsai Institute',
        }),
      ]),
    );
  });
});
