import { afterEach, describe, expect, it } from 'vitest';
import {
  GIVEN_NAME_SHORT_FORMS,
  replaceNicknameInQuery,
  resolveNicknameInNameQuery,
} from '../nameQueryNicknames';
import {
  buildSearchSpellingVocabulary,
  type SearchVocabularyDocument,
} from '../searchQuerySpellingCorrection';
import { setResearchSearchSpellingVocabularyForTests } from '../researchSearchSpellingVocabulary';
import {
  expandNicknameInResearchNameQuery,
  searchRerankCacheQueryKey,
} from '../researchGroupService';

const personRow = (...people: string[]): SearchVocabularyDocument => ({
  nameText: [people],
  personNameText: [people],
  bodyText: ['art history', 'will power and self control', 'green chemistry'],
  served: true,
});

const vocabulary = buildSearchSpellingVocabulary([
  personRow('Robert Quillfeather'),
  personRow('William Thornbury'),
  personRow('Jane Power'),
  personRow('Arthur Fennimore'),
  personRow('Ruth Green'),
  personRow('Christine Vandermolen', 'Christopher Vandermolen'),
  personRow('Christine Ida Vandermolen'),
  personRow('Christina Vandermolen'),
  personRow('Bob Starwhistle', 'Robert Starwhistle'),
  personRow('Patricia Elm Oakhollow'),
]);

afterEach(() => setResearchSearchSpellingVocabularyForTests(null));

describe('GIVEN_NAME_SHORT_FORMS', () => {
  it('stays a small table of lowercase short forms, none of which is its own full form', () => {
    const entries = Object.entries(GIVEN_NAME_SHORT_FORMS);
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.length).toBeLessThan(150);
    for (const [shortForm, givenNames] of entries) {
      expect(shortForm).toMatch(/^[a-z]+$/);
      expect(givenNames.length).toBeGreaterThan(0);
      for (const givenName of givenNames) {
        expect(givenName).toMatch(/^[a-z]+$/);
        expect(givenName).not.toBe(shortForm);
      }
    }
  });
});

describe('resolveNicknameInNameQuery', () => {
  it('maps a short given name to the full given name a person with that surname carries', () => {
    expect(resolveNicknameInNameQuery(['bob', 'quillfeather'], vocabulary)).toEqual({
      nickname: 'bob',
      givenName: 'robert',
    });
    expect(resolveNicknameInNameQuery(['bill', 'thornbury'], vocabulary)).toEqual({
      nickname: 'bill',
      givenName: 'william',
    });
    expect(resolveNicknameInNameQuery(['pat', 'elm', 'oakhollow'], vocabulary)).toEqual({
      nickname: 'pat',
      givenName: 'patricia',
    });
  });

  it('prefers the full given name more distinct people with that surname carry', () => {
    expect(resolveNicknameInNameQuery(['chris', 'vandermolen'], vocabulary)?.givenName).toBe(
      'christine',
    );
  });

  it('reads only served people, so a person on an unserved row neither triggers nor blocks a rewrite', () => {
    const unservedOnly = buildSearchSpellingVocabulary([
      { ...personRow('Robert Hollowmere'), served: false },
      { ...personRow('Bob Quillfeather'), served: false },
      personRow('Robert Quillfeather'),
    ]);
    expect(resolveNicknameInNameQuery(['bob', 'hollowmere'], unservedOnly)).toBeNull();
    expect(resolveNicknameInNameQuery(['bob', 'quillfeather'], unservedOnly)).toEqual({
      nickname: 'bob',
      givenName: 'robert',
    });
  });

  it('never introduces a given name no person with the other words carries', () => {
    expect(resolveNicknameInNameQuery(['will', 'quillfeather'], vocabulary)).toBeNull();
    expect(resolveNicknameInNameQuery(['tom', 'quillfeather'], vocabulary)).toBeNull();
  });

  it('leaves a short form that a person name already carries as typed', () => {
    expect(resolveNicknameInNameQuery(['bob', 'starwhistle'], vocabulary)).toBeNull();
  });

  it('leaves topic queries whose first word is also a short given name untouched', () => {
    expect(resolveNicknameInNameQuery(['art', 'history'], vocabulary)).toBeNull();
    expect(resolveNicknameInNameQuery(['bill', 'of', 'rights'], vocabulary)).toBeNull();
    expect(resolveNicknameInNameQuery(['pat', 'testing'], vocabulary)).toBeNull();
  });

  it('leaves a name-shaped topic query untouched when no one person carries both words', () => {
    expect(resolveNicknameInNameQuery(['will', 'power'], vocabulary)).toBeNull();
    expect(resolveNicknameInNameQuery(['art', 'green'], vocabulary)).toBeNull();
  });

  it('only reads a short form in the given-name position of a short query', () => {
    expect(resolveNicknameInNameQuery(['quillfeather', 'bob'], vocabulary)).toBeNull();
    expect(resolveNicknameInNameQuery(['bob'], vocabulary)).toBeNull();
    expect(
      resolveNicknameInNameQuery(['bob', 'quillfeather', 'lab', 'members'], vocabulary),
    ).toBeNull();
  });

  it('does nothing without a vocabulary', () => {
    expect(resolveNicknameInNameQuery(['bob', 'quillfeather'], null)).toBeNull();
  });
});

describe('replaceNicknameInQuery', () => {
  it('replaces the typed short form as a whole word, whatever its case', () => {
    expect(
      replaceNicknameInQuery('Bob Quillfeather', { nickname: 'bob', givenName: 'robert' }),
    ).toBe('robert Quillfeather');
    expect(
      replaceNicknameInQuery('bobby bob quillfeather', { nickname: 'bob', givenName: 'robert' }),
    ).toBe('bobby robert quillfeather');
  });
});

describe('expandNicknameInResearchNameQuery', () => {
  it('expands a name query and leaves topic queries as typed', () => {
    setResearchSearchSpellingVocabularyForTests(vocabulary);
    expect(expandNicknameInResearchNameQuery('Bob Quillfeather')).toBe('robert Quillfeather');
    expect(expandNicknameInResearchNameQuery('art history')).toBe('art history');
    expect(expandNicknameInResearchNameQuery('will power')).toBe('will power');
    expect(expandNicknameInResearchNameQuery('Art Green')).toBe('Art Green');
  });

  it('decides on the query words left after filler words are dropped', () => {
    setResearchSearchSpellingVocabularyForTests(vocabulary);
    expect(expandNicknameInResearchNameQuery('professor bob quillfeather lab')).toBe(
      'professor robert quillfeather lab',
    );
  });

  it('is a no-op before the vocabulary loads', () => {
    expect(expandNicknameInResearchNameQuery('bob quillfeather')).toBe('bob quillfeather');
  });

  it('keeps the rerank cache key on the query as typed', () => {
    setResearchSearchSpellingVocabularyForTests(vocabulary);
    expect(searchRerankCacheQueryKey('bob quillfeather')).toBe(
      JSON.stringify(['bob quillfeather', []]),
    );
  });
});
