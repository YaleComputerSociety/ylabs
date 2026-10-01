import { describe, expect, it } from 'vitest';
import { programFundIdentityKey, selectDuplicateProgramCopies } from '../programDuplicateIdentity';

const DESCRIPTION =
  'The fixture fund supports undergraduates who plan summer research projects in the humanities and social sciences.';

describe('programFundIdentityKey', () => {
  it('identifies a fund by its title and its own description, ignoring case and punctuation', () => {
    expect(programFundIdentityKey({ title: 'Fixture Fund', description: DESCRIPTION })).toBe(
      programFundIdentityKey({ title: 'fixture  fund.', description: DESCRIPTION.toUpperCase() }),
    );
  });

  it('refuses to identify a fund by a title alone or a description too short to tell funds apart', () => {
    expect(programFundIdentityKey({ title: 'Fixture Fund', description: '' })).toBeNull();
    expect(
      programFundIdentityKey({ title: 'Fixture Fund', description: 'Supports research.' }),
    ).toBeNull();
    expect(programFundIdentityKey({ title: '', description: DESCRIPTION })).toBeNull();
  });
});

describe('selectDuplicateProgramCopies', () => {
  const copy = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    title: 'Fixture Fund',
    description: DESCRIPTION,
    sourceName: 'yale-college-fellowships-office',
    tier: 'student_ready',
    ...overrides,
  });

  it('keeps the copy most fit to serve and retires the rest onto it', () => {
    const copies = selectDuplicateProgramCopies([
      copy('a', { tier: 'suppressed' }),
      copy('b', { tier: 'student_ready', sourceName: 'student-grants-database' }),
    ]);
    expect([...copies]).toEqual([['a', 'b']]);
  });

  it('prefers the owning lane over the enrich-only catalog when both could serve', () => {
    const copies = selectDuplicateProgramCopies([
      copy('a', { sourceName: 'student-grants-database' }),
      copy('b'),
    ]);
    expect([...copies]).toEqual([['a', 'b']]);
  });

  it('keeps the older row when nothing else separates two copies', () => {
    expect([...selectDuplicateProgramCopies([copy('b'), copy('a')])]).toEqual([['b', 'a']]);
  });

  it('leaves distinct funds that share a title alone', () => {
    expect(
      selectDuplicateProgramCopies([
        copy('a'),
        copy('b', { description: `${DESCRIPTION} Open to juniors in a residential college.` }),
      ]).size,
    ).toBe(0);
  });
});
