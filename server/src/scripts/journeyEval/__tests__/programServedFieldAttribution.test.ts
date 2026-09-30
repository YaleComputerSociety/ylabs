import { describe, expect, it } from 'vitest';
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

  it('attributes a withheld non-http apply link to the public url guard', () => {
    const stored = { ...recurringStoredRow, applicationLink: 'mailto:office@example.edu' };
    const outcomes = attributeProgramServedFields(
      stored,
      { ...stored, applicationLink: undefined },
      servedAt,
    );

    expect(outcomeFor(outcomes, 'applicationLink')).toEqual({
      field: 'applicationLink',
      status: 'attributed',
      guard: 'publicHttpUrl',
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
