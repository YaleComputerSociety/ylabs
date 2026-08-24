import { describe, expect, it } from 'vitest';
import {
  buildFellowshipResearchEntityProjection,
  projectedProgramSlug,
  selectProjectedAccessSignals,
  selectProjectedProgramEntityType,
  type FellowshipProjectionInput,
} from '../fellowshipResearchEntityProjection';

const baseStudentReadyProgram: FellowshipProjectionInput = {
  sourceKey: 'stars-summer-research-program',
  title: 'STARS Summer Research Program',
  summary: 'A structured summer research program placing undergraduates in Yale labs.',
  description:
    'The STARS Summer Research Program supports undergraduate researchers over the summer with mentored laboratory research and a stipend.',
  studentFacingCategory: 'Structured summer program',
  programKind: 'STRUCTURED_PROGRAM',
  programCategory: 'SUMMER_RESEARCH_PROGRAM',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  purpose: ['Research'],
  sourceUrl: 'https://onhsa.yale.edu/programs/stars',
  sourceName: 'yale-college-fellowships-office',
  studentVisibilityTier: 'student_ready',
  archived: false,
};

describe('selectProjectedProgramEntityType', () => {
  it('maps research-participation programs to RA_PROGRAM', () => {
    expect(selectProjectedProgramEntityType({ programKind: 'RA_PROGRAM' })).toBe('RA_PROGRAM');
    expect(selectProjectedProgramEntityType({ programCategory: 'SUMMER_RESEARCH_PROGRAM' })).toBe(
      'RA_PROGRAM',
    );
    expect(selectProjectedProgramEntityType({ programKind: 'MENTOR_MATCHING' })).toBe('RA_PROGRAM');
    expect(selectProjectedProgramEntityType({ programCategory: 'CENTER_INTERNSHIP' })).toBe(
      'RA_PROGRAM',
    );
  });

  it('maps pure funding programs to FELLOWSHIP_PROGRAM', () => {
    expect(
      selectProjectedProgramEntityType({
        programKind: 'FELLOWSHIP_FUNDING',
        programCategory: 'FELLOWSHIP',
      }),
    ).toBe('FELLOWSHIP_PROGRAM');
    expect(selectProjectedProgramEntityType({ programKind: 'TRAVEL_RESEARCH_GRANT' })).toBe(
      'FELLOWSHIP_PROGRAM',
    );
    expect(selectProjectedProgramEntityType({ programKind: 'SENIOR_THESIS_FUNDING' })).toBe(
      'FELLOWSHIP_PROGRAM',
    );
  });
});

describe('projectedProgramSlug', () => {
  it('is stable across runs and namespaced under program-', () => {
    const slug = projectedProgramSlug(baseStudentReadyProgram);
    expect(slug).toBe('program-stars-summer-research-program');
    expect(projectedProgramSlug(baseStudentReadyProgram)).toBe(slug);
  });

  it('falls back to a normalized title key when sourceKey is missing', () => {
    const slug = projectedProgramSlug({ title: 'Dean’s Research Fellowship!!!' });
    expect(slug).toMatch(/^program-/);
    expect(slug).toBe(projectedProgramSlug({ title: 'Dean’s Research Fellowship!!!' }));
  });

  it('returns null when there is no key material', () => {
    expect(projectedProgramSlug({})).toBeNull();
  });
});

describe('selectProjectedAccessSignals', () => {
  it('always emits APPLICATION_ONLY and adds RECURRING_PROGRAM for recurring programs', () => {
    const signals = selectProjectedAccessSignals(baseStudentReadyProgram);
    const types = signals.map((s) => s.type);
    expect(types).toContain('APPLICATION_ONLY');
    expect(types).toContain('RECURRING_PROGRAM');
  });

  it('emits APPLICATION_FORM_EXISTS for a non-recurring program with an application route', () => {
    const signals = selectProjectedAccessSignals({
      title: 'A Fellowship',
      programCategory: 'FELLOWSHIP',
      applicationLink: 'https://apply.example.edu/fellowship',
    });
    const types = signals.map((s) => s.type);
    expect(types).toEqual(['APPLICATION_ONLY', 'APPLICATION_FORM_EXISTS']);
  });
});

describe('buildFellowshipResearchEntityProjection', () => {
  it('projects a student_ready research program into a first-class RA_PROGRAM home', () => {
    const projection = buildFellowshipResearchEntityProjection(baseStudentReadyProgram);
    if ('skip' in projection) throw new Error(`expected projection, got skip ${projection.skip}`);

    expect(projection.slug).toBe('program-stars-summer-research-program');
    expect(projection.entityType).toBe('RA_PROGRAM');
    expect(projection.set.kind).toBe('program');
    expect(projection.set.name).toBe('STARS Summer Research Program');
    expect(projection.set.studentVisibilityTier).toBe('student_ready');
    expect(projection.set.archived).toBe(false);
    expect(projection.set.sourceUrls).toEqual(['https://onhsa.yale.edu/programs/stars']);
    expect(projection.set.websiteUrl).toBe('https://onhsa.yale.edu/programs/stars');
    expect(projection.accessSignals.map((s) => s.type)).toContain('APPLICATION_ONLY');
  });

  it('redacts direct contact info from the projected description', () => {
    const projection = buildFellowshipResearchEntityProjection({
      ...baseStudentReadyProgram,
      description:
        'Undergraduates do mentored research. Questions? Email director@example.edu or call 203-432-1234.',
    });
    if ('skip' in projection) throw new Error(`expected projection, got skip ${projection.skip}`);
    const full = String(projection.set.fullDescription);
    expect(full).not.toContain('director@example.edu');
    expect(full).not.toContain('203-432-1234');
  });

  it('skips a fellowship that is not student_ready', () => {
    const projection = buildFellowshipResearchEntityProjection({
      ...baseStudentReadyProgram,
      studentVisibilityTier: 'operator_review',
    });
    expect('skip' in projection && projection.skip).toBe('not-student-ready');
    expect('skip' in projection && projection.slug).toBe('program-stars-summer-research-program');
  });

  it('skips an archived fellowship', () => {
    const projection = buildFellowshipResearchEntityProjection({
      ...baseStudentReadyProgram,
      archived: true,
    });
    expect('skip' in projection && projection.skip).toBe('archived');
  });

  it('skips a non-research program', () => {
    const projection = buildFellowshipResearchEntityProjection({
      sourceKey: 'yale-daily-news-journalism-award',
      title: 'Yale Journalism Award',
      summary: 'Recognizes excellence in student journalism.',
      description: 'An award for outstanding journalism, not research.',
      programKind: 'OTHER',
      programCategory: 'FELLOWSHIP',
      purpose: ['Journalism'],
      sourceUrl: 'https://example.edu/journalism-award',
      studentVisibilityTier: 'student_ready',
    });
    expect('skip' in projection && projection.skip).toBe('not-research-related');
  });

  it('fails closed when there is no usable public source URL', () => {
    const projection = buildFellowshipResearchEntityProjection({
      ...baseStudentReadyProgram,
      sourceUrl: 'https://onhsa.yale.edu/people/',
      applicationLink: '',
      links: [],
    });
    expect('skip' in projection && projection.skip).toBe('no-public-source-url');
  });
});
