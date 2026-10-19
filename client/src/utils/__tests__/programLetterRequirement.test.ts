import { describe, expect, it } from 'vitest';
import { noMentorFirstAnswer, programLetterRequirement } from '../programLetterRequirement';

describe('programLetterRequirement', () => {
  it.each([
    [['One letter of recommendation from a faculty advisor'], '', 'faculty'],
    [[], 'Three letters of recommendation: one must be written by a faculty member.', 'faculty'],
    [['Faculty Reference: ask your adviser for a brief note.'], '', 'faculty'],
    [
      [],
      'The complete application, including letter of recommendation and transcripts.',
      'recommendation',
    ],
    [['CV', 'Budget', 'Two letters of reference'], '', 'recommendation'],
    [[], 'A letter or email of recommendation, and a budget.', 'recommendation'],
  ])('reads %j / %j as %s', (materials, information, expected) => {
    expect(
      programLetterRequirement({
        applicationMaterials: materials,
        applicationInformation: information,
      }),
    ).toBe(expected);
  });

  it.each([
    'A letter of recommendation is not required but you should discuss the project with a faculty member.',
    'Submit receipts within 10 days of receiving your award letter.',
    'Upload your CV, cover letter, and transcripts.',
    'Include a bibliography, references, or illustrations, when appropriate.',
    'A letter of acceptance to the internship.',
  ])('does not read %j as a letter requirement', (information) => {
    expect(programLetterRequirement({ applicationInformation: information })).toBeNull();
  });

  it('names the letter in the no-mentor answer and keeps the plain answer otherwise', () => {
    expect(noMentorFirstAnswer('faculty')).toBe(
      'No mentor needed first, but you will need a faculty letter',
    );
    expect(noMentorFirstAnswer('recommendation')).toBe(
      'No mentor needed first, but you will need a recommendation letter',
    );
    expect(noMentorFirstAnswer(null)).toBe('Not usually');
  });
});
