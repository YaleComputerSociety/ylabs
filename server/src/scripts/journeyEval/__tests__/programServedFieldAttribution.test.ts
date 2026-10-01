import { describe, expect, it } from 'vitest';
import {
  PROGRAM_READER_FIELD_DECISIONS,
  publicProgramForReader,
} from '../../../controllers/programPayload';
import { publicFellowshipForStudent } from '../../../services/fellowshipService';
import {
  attributeProgramServedFields,
  type ProgramAttributedField,
  type ProgramFieldOutcome,
} from '../programServedFieldAttribution';

const servedAt = {
  from: new Date('2026-09-30T12:00:00.000Z'),
  to: new Date('2026-09-30T12:00:05.000Z'),
};

const outcomeFor = (
  outcomes: ProgramFieldOutcome[],
  field: ProgramAttributedField,
): ProgramFieldOutcome => {
  const outcome = outcomes.find((candidate) => candidate.field === field);
  if (!outcome) throw new Error(`no outcome for ${field}`);
  return outcome;
};

const recurringStoredRow = {
  title: 'Synthetic Summer Research Fellowship',
  summary: 'An annual summer research fellowship with a stipend.',
  applicationLink: 'https://apply.example.edu/programs/synthetic-fellowship',
  sourceUrl: 'https://funding.example.edu/programs/synthetic-fellowship',
  deadline: new Date('2026-02-01T05:00:00.000Z'),
  isAcceptingApplications: true,
  eligibility: 'Open to undergraduates in any year.',
};

describe('attributeProgramServedFields', () => {
  it('reports nothing when the served row carries the stored values', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-12-01T05:00:00.000Z') };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, deadlineProjectedNextCycle: false },
      servedAt,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
  });

  it('attributes a past recurring deadline served one cycle later to the projection', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      {
        ...recurringStoredRow,
        deadline: new Date('2027-02-01T05:00:00.000Z'),
        deadlineProjectedNextCycle: true,
        isAcceptingApplications: false,
      },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'deadline')).toEqual({
      field: 'deadline',
      status: 'attributed',
      guard: 'projectNextCycleDeadline',
    });
    expect(outcomeFor(outcomes, 'isAcceptingApplications')).toEqual({
      field: 'isAcceptingApplications',
      status: 'attributed',
      guard: 'deadlineIsPast',
    });
  });

  it('attributes a date-only deadline served at the end of its New York day to the close guard', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-12-01T23:59:59.999Z') };
    const served = publicFellowshipForStudent(stored, servedAt.from);

    expect(served.deadline.toISOString()).toBe('2026-12-02T04:59:59.999Z');
    expect(outcomeFor(attributeProgramServedFields(stored, served, servedAt), 'deadline')).toEqual({
      field: 'deadline',
      status: 'attributed',
      guard: 'programDeadlineClosesAt',
    });
  });

  it('flags a date-only deadline served at the end of the UTC day the close guard moves', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-12-01T23:59:59.999Z') };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, deadlineProjectedNextCycle: false },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'deadline').status).toBe('unexplained');
  });

  it('attributes a past date-only recurring deadline to the projection of its closing instant', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-02-01T23:59:59.999Z') };
    const served = publicFellowshipForStudent(stored, servedAt.from);

    expect(served.deadlineProjectedNextCycle).toBe(true);
    expect(served.deadline.toISOString()).toBe('2027-02-02T04:59:59.999Z');
    const outcomes = attributeProgramServedFields(stored, served, servedAt);
    expect(outcomeFor(outcomes, 'deadline')).toEqual({
      field: 'deadline',
      status: 'attributed',
      guard: 'projectNextCycleDeadline',
    });
    expect(outcomeFor(outcomes, 'isAcceptingApplications')).toEqual({
      field: 'isAcceptingApplications',
      status: 'attributed',
      guard: 'deadlineIsPast',
    });
  });

  it('keeps an application open until the end of the New York day of a date-only deadline', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-09-30T23:59:59.999Z') };
    const eveningInNewYork = {
      from: new Date('2026-10-01T02:00:00.000Z'),
      to: new Date('2026-10-01T02:00:05.000Z'),
    };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, isAcceptingApplications: false },
      eveningInNewYork,
    );

    expect(outcomeFor(outcomes, 'isAcceptingApplications').status).toBe('unexplained');
  });

  it('flags a served deadline the projection would not produce', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      {
        ...recurringStoredRow,
        deadline: new Date('2028-06-15T05:00:00.000Z'),
        deadlineProjectedNextCycle: true,
      },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'deadline').status).toBe('unexplained');
  });

  it('flags a projection flag on a row serving its stored deadline', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      { ...recurringStoredRow, deadlineProjectedNextCycle: true },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'deadline').status).toBe('unexplained');
  });

  it('flags a row served as closed while its deadline is still ahead', () => {
    const stored = { ...recurringStoredRow, deadline: new Date('2026-12-01T05:00:00.000Z') };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, isAcceptingApplications: false },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'isAcceptingApplications').status).toBe('unexplained');
  });

  it('attributes a non-http apply link the student projection drops to that projection', () => {
    const stored = { ...recurringStoredRow, applicationLink: 'mailto:office@example.edu' };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, applicationLink: undefined },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'applicationLink')).toEqual({
      field: 'applicationLink',
      status: 'attributed',
      guard: 'publicFellowshipForStudent',
    });
  });

  it('attributes a withheld bare domain root apply link to the unhelpful url guard', () => {
    const stored = { ...recurringStoredRow, applicationLink: 'https://www.example.edu/' };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, applicationLink: undefined },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'applicationLink')).toEqual({
      field: 'applicationLink',
      status: 'attributed',
      guard: 'isUnhelpfulProgramUrl',
    });
  });

  it('attributes an apply link withheld from department research guidance to that guard', () => {
    const stored = {
      ...recurringStoredRow,
      deadline: undefined,
      isAcceptingApplications: undefined,
      programKind: 'DEPARTMENT_RESEARCH_GUIDE',
      sourcePageTitle: 'Undergraduate Research Opportunities',
    };
    const served = publicProgramForReader(publicFellowshipForStudent(stored, servedAt.from));

    expect(served.applicationLink).toBeUndefined();
    expect(
      outcomeFor(attributeProgramServedFields(stored, served, servedAt), 'applicationLink'),
    ).toEqual({
      field: 'applicationLink',
      status: 'attributed',
      guard: 'departmentResearchGuidance',
    });
  });

  it('flags a specific public apply link the served row withholds', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      { ...recurringStoredRow, applicationLink: undefined },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'applicationLink').status).toBe('unexplained');
  });

  it('flags a served apply link that is not the stored one', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      { ...recurringStoredRow, applicationLink: 'https://elsewhere.example.org/apply' },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'applicationLink').status).toBe('unexplained');
  });

  it('flags stored eligibility the served row withholds while the sanitizer keeps it', () => {
    const outcomes = attributeProgramServedFields(
      recurringStoredRow,
      { ...recurringStoredRow, eligibility: '' },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'eligibility').status).toBe('unexplained');
  });

  it('attributes withheld contact-only eligibility to the description sanitizer', () => {
    const stored = { ...recurringStoredRow, eligibility: 'office@example.edu' };
    const outcomes = attributeProgramServedFields(stored, { ...stored, eligibility: '' }, servedAt);

    expect(outcomeFor(outcomes, 'eligibility')).toEqual({
      field: 'eligibility',
      status: 'attributed',
      guard: 'publicProgramDescription',
    });
  });

  it('flags eligibility the served row carries but the stored row lacks', () => {
    const stored = { ...recurringStoredRow, eligibility: '' };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, eligibility: 'Invented eligibility text.' },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'eligibility').status).toBe('unexplained');
  });
});

describe('program reader decision registry', () => {
  const guidanceRow = {
    ...recurringStoredRow,
    deadline: undefined,
    isAcceptingApplications: undefined,
    programKind: 'DEPARTMENT_RESEARCH_GUIDE',
    sourcePageTitle: 'Undergraduate Research Opportunities',
  };
  const storedRows = [
    recurringStoredRow,
    guidanceRow,
    { ...recurringStoredRow, applicationLink: 'mailto:office@example.edu' },
    { ...recurringStoredRow, applicationLink: 'https://www.example.edu/' },
    { ...recurringStoredRow, eligibility: 'office@example.edu' },
    { ...recurringStoredRow, applicationLink: undefined, eligibility: undefined },
  ];

  it('serves each decided field as exactly the value its decision returns', () => {
    for (const stored of storedRows) {
      const readerInput = publicFellowshipForStudent(stored, servedAt.from);
      const served = publicProgramForReader(readerInput) as Record<string, unknown>;
      for (const [field, decide] of Object.entries(PROGRAM_READER_FIELD_DECISIONS)) {
        expect(served[field]).toEqual(decide(readerInput).value);
      }
    }
  });

  it('explains every difference the real serve path makes on these rows', () => {
    for (const stored of storedRows) {
      const served = publicProgramForReader(publicFellowshipForStudent(stored, servedAt.from));
      const unexplained = attributeProgramServedFields(stored, served, servedAt).filter(
        (outcome) => outcome.status === 'unexplained',
      );
      expect(unexplained).toEqual([]);
    }
  });
});
