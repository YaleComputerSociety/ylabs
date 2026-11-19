import { describe, expect, it } from 'vitest';
import { programStatesRollingReview } from '../programRollingReview';

describe('programStatesRollingReview (#6407)', () => {
  it.each([
    'Applications are accepted throughout the semester on a rolling basis.',
    'Applications are accepted on a rolling basis. Applicants cannot receive funding more than once per year.',
    'Funding is limited and will be given on a rolling basis.',
    'Eligible students may apply year-round, as applications are reviewed and funds awarded on a rolling basis.',
    'Please note: Applications for this funding are rolling.',
  ])('reads rolling review in %j', (text) => {
    expect(programStatesRollingReview({ description: text })).toBe(true);
  });

  it('reads rolling review from the stored source text a student is not served', () => {
    expect(
      programStatesRollingReview({
        description: 'Supports research during the academic year.',
        fullSourceDescription: 'Applications are accepted on a rolling basis.',
      }),
    ).toBe(true);
  });

  it.each([
    'Applications are reviewed once per year. Application deadline: December 1, 11:59 PM ET. NB: Applications are not reviewed on a rolling basis.',
    'Round 2 - March 24 (use this deadline for summer awards). NB: Applications are not reviewed on a rolling basis.',
    'Awards will never be made on a rolling basis.',
  ])('keeps a fixed deadline the text states in %j', (text) => {
    expect(programStatesRollingReview({ description: text })).toBe(false);
  });

  it('keeps a recurring monthly cutoff described as a rolling deadline', () => {
    expect(
      programStatesRollingReview({
        description:
          'Please note: this application has a "rolling deadline." Applications are due on the last Friday of each month.',
      }),
    ).toBe(false);
    expect(
      programStatesRollingReview({
        description: 'Applications are reviewed monthly on a rolling basis.',
      }),
    ).toBe(false);
  });

  it('keeps a per-college copy whose shared schedule text never states rolling review', () => {
    expect(
      programStatesRollingReview({
        fullSourceDescription:
          'Each college should have a formal application process to select undergraduates for research awards. Each college determines its own schedule for accepting applications and for student presentations.',
      }),
    ).toBe(false);
  });

  it('reads rolling review beside a rolling deadline that does not recur', () => {
    expect(
      programStatesRollingReview({
        description:
          'This grant has a rolling deadline. Applications are reviewed on a rolling basis until funds run out.',
      }),
    ).toBe(true);
  });

  it('ignores rolling that is not about the application', () => {
    expect(
      programStatesRollingReview({
        description:
          'Fieldwork takes place in the rolling hills of the study region. Applications are due March 1.',
      }),
    ).toBe(false);
  });

  it('keeps a program with no text', () => {
    expect(programStatesRollingReview({})).toBe(false);
    expect(programStatesRollingReview(null)).toBe(false);
  });
});
