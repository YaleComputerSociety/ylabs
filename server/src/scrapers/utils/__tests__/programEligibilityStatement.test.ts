import { describe, expect, it } from 'vitest';
import {
  eligibilitySentences,
  eligibilityStatement,
  isEligibilitySentence,
} from '../programEligibilityStatement';

describe('eligibilitySentences', () => {
  it('keeps the sentences that say who may apply, in page order', () => {
    const blocks = [
      'The Fixture Fellowship funds ten weeks of summer research.',
      'Currently enrolled sophomores and juniors are eligible to apply. Awards are paid in June.',
      'All undergraduate students are welcome to apply; however, preference will be given to majors.',
    ];
    expect(eligibilitySentences(blocks)).toEqual([
      'Currently enrolled sophomores and juniors are eligible to apply.',
      'All undergraduate students are welcome to apply; however, preference will be given to majors.',
    ]);
  });

  it('reads the population a catalog entry names for its award', () => {
    expect(
      isEligibilitySentence(
        'Funding for Yale University graduate students who expect to be engaged in dissertation research.',
      ),
    ).toBe(true);
    expect(
      isEligibilitySentence(
        'The center announces grants to support Ph.D. students who will be engaged in field research.',
      ),
    ).toBe(true);
    expect(
      isEligibilitySentence(
        'The council invites applications from graduate and undergraduate students whose research concerns the region.',
      ),
    ).toBe(true);
  });

  it('needs an applicant, so a project-level eligibility line is not a statement', () => {
    expect(isEligibilitySentence('This project is eligible for remote work.')).toBe(false);
    expect(
      isEligibilitySentence(
        'Further information about eligibility is provided in the instructions.',
      ),
    ).toBe(false);
  });

  it('fails closed on a sentence that carries contact data', () => {
    expect(
      isEligibilitySentence(
        'Eligible students should email fixture.office@example.edu before applying.',
      ),
    ).toBe(false);
    expect(
      isEligibilitySentence('Graduate students are eligible; contact the program office to apply.'),
    ).toBe(false);
    expect(
      isEligibilitySentence(
        'Eligible students should reach out to Professor Fixture before applying.',
      ),
    ).toBe(false);
    expect(
      isEligibilitySentence(
        'Juniors are eligible and should speak with the fixture adviser first.',
      ),
    ).toBe(false);
    expect(
      isEligibilitySentence(
        'Undergraduates are eligible and may call 203-555-0100 with questions.',
      ),
    ).toBe(false);
  });

  it('never reads a staff title line or a conditional aside as a statement', () => {
    expect(isEligibilitySentence('Associate Dean for Graduate Student Engagement')).toBe(false);
    expect(
      isEligibilitySentence(
        '**Note: if you are a senior, the conference must occur before graduation to be eligible for funding.',
      ),
    ).toBe(false);
  });

  it('does not split a sentence at an initialism', () => {
    expect(
      eligibilitySentences([
        'Fellowships are for Yale graduate and undergraduate students who are children of U.S. Foreign Service officers.',
      ]),
    ).toEqual([
      'Fellowships are for Yale graduate and undergraduate students who are children of U.S. Foreign Service officers.',
    ]);
  });

  it('bounds the statement to a few sentences', () => {
    const blocks = Array.from(
      { length: 6 },
      (_value, index) => `Students in cohort ${index + 1} are eligible to apply.`,
    );
    const sentences = eligibilitySentences(blocks);
    expect(sentences).toHaveLength(3);
    expect(eligibilityStatement(sentences)).toBe(sentences.join(' '));
    expect(eligibilityStatement([])).toBeUndefined();
  });
});
