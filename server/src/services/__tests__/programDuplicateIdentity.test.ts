import { describe, expect, it } from 'vitest';
import { programFundTitleKey, selectDuplicateProgramCopies } from '../programDuplicateIdentity';

const DESCRIPTION =
  'The fixture fund supports undergraduates who plan summer research projects in the humanities and social sciences, with awards for travel, living costs, and materials.';

const copy = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: 'Fixture Fund',
  description: DESCRIPTION,
  sourceName: 'yale-college-fellowships-office',
  tier: 'student_ready',
  ...overrides,
});

const redundant = (...copies: ReturnType<typeof copy>[]) => [
  ...selectDuplicateProgramCopies(copies),
];

describe('programFundTitleKey', () => {
  it('reads a title the same whatever its case, punctuation, ampersand, or leading article', () => {
    expect(programFundTitleKey('The Fixture Research & Travel Fellowship')).toBe(
      programFundTitleKey('fixture research and travel fellowship'),
    );
    expect(programFundTitleKey('Fixture’s Fund')).toBe(programFundTitleKey("Fixture's Fund"));
  });
});

describe('selectDuplicateProgramCopies', () => {
  it('keeps the copy most fit to serve and retires the rest onto it', () => {
    expect(
      redundant(
        copy('a', { tier: 'suppressed' }),
        copy('b', { sourceName: 'student-grants-database' }),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('prefers the owning lane over the enrich-only catalog when both could serve', () => {
    expect(redundant(copy('a', { sourceName: 'student-grants-database' }), copy('b'))).toEqual([
      ['a', 'b'],
    ]);
  });

  it('keeps the older row when nothing else separates two copies', () => {
    expect(redundant(copy('b'), copy('a'))).toEqual([['b', 'a']]);
  });

  it('joins copies whose titles differ only by an article or an ampersand', () => {
    expect(
      redundant(
        copy('a', { title: 'The Fixture Research & Travel Fund' }),
        copy('b', { title: 'Fixture Research and Travel Fund' }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('joins a fund paragraph to a copy that stored the whole page around it', () => {
    expect(
      redundant(
        copy('a', { sourceName: 'student-grants-database' }),
        copy('b', {
          description: `Student and faculty awards. Apply now. ${DESCRIPTION} Questions go to the fellowships office, and recipients are announced in April.`,
        }),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('leaves funds that share a description but name different colleges apart', () => {
    expect(
      redundant(
        copy('a', { title: 'North College Fixture Fund' }),
        copy('b', { title: 'South College Fixture Fund' }),
      ),
    ).toEqual([]);
  });

  it('leaves funds that share a title but describe different awards apart', () => {
    expect(
      redundant(
        copy('a'),
        copy('b', {
          description:
            'A different fixture award pays for a semester of language study abroad for sophomores, covering tuition at an approved partner program.',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses to join copies on a title alone or a description too short to tell funds apart', () => {
    expect(redundant(copy('a', { description: '' }), copy('b', { description: '' }))).toEqual([]);
    expect(
      redundant(
        copy('a', { description: 'Supports research.' }),
        copy('b', { description: 'Supports research.' }),
      ),
    ).toEqual([]);
  });
});
