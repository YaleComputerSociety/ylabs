import { describe, expect, it } from 'vitest';
import {
  boundedEditDistance,
  buildSearchSpellingVocabulary,
  correctSearchQuerySpelling,
  type SearchVocabularyDocument,
} from '../searchQuerySpellingCorrection';

const repeat = (
  count: number,
  document: Omit<SearchVocabularyDocument, 'served'>,
): SearchVocabularyDocument[] => Array.from({ length: count }, () => ({ ...document, served: true }));

const vocabulary = buildSearchSpellingVocabulary([
  ...repeat(40, { nameText: ['Example Lab'], bodyText: ['neuroscience of sleep and memory'] }),
  ...repeat(25, { nameText: ['Sample Center'], bodyText: [['immunology', 'genetics']] }),
  ...repeat(12, { nameText: ['Other Group'], bodyText: ['machine learning for biology'] }),
  ...repeat(30, { nameText: [], bodyText: ['brain imaging'] }),
  ...repeat(10, { nameText: [], bodyText: ['pain research'] }),
  ...repeat(4, { nameText: [], bodyText: ['paid summer position'] }),
  ...repeat(1, { nameText: [['Zorvath Quellin']], bodyText: ['studies of zorvath patterns'] }),
  ...repeat(1, { nameText: [], bodyText: ['a single neurosceince typo in prose'] }),
  ...repeat(1, { nameText: [['Vexmał Orrin']], bodyText: [] }),
  ...repeat(5, { nameText: [], bodyText: ['vexmail'] }),
]);

const correct = (query: string, protectedTerms?: ReadonlySet<string>) =>
  correctSearchQuerySpelling(query, vocabulary, protectedTerms);

describe('correctSearchQuerySpelling', () => {
  it('corrects a misspelled word to the corpus word it is one edit from', () => {
    expect(correct('imunology')).toEqual({
      query: 'immunology',
      corrections: [{ from: 'imunology', to: 'immunology' }],
    });
  });

  it('treats a swapped pair of letters as one edit', () => {
    expect(correct('gentics').query).toBe('genetics');
    expect(boundedEditDistance('slepe', 'sleep', 1)).toBe(1);
  });

  it('allows two edits only for a word of nine or more letters', () => {
    expect(correct('nueroscence').query).toBe('neuroscience');
    expect(correct('gnteics').query).toBe('gnteics');
  });

  it('corrects only the misspelled word and keeps the rest of the query as typed', () => {
    expect(correct('Machine lerning for Biolgy')).toEqual({
      query: 'Machine learning for biology',
      corrections: [
        { from: 'lerning', to: 'learning' },
        { from: 'Biolgy', to: 'biology' },
      ],
    });
  });

  it('never rewrites a word the corpus carries, even in a single row', () => {
    expect(correct('neurosceince')).toEqual({ query: 'neurosceince', corrections: [] });
  });

  it('never rewrites a word the corpus holds in enough rows to be a real word', () => {
    expect(correct('paid position')).toEqual({ query: 'paid position', corrections: [] });
  });

  it('never rewrites a word that appears in a name, however rare', () => {
    expect(correct('quellin').corrections).toEqual([]);
    expect(correct('zorvath').corrections).toEqual([]);
  });

  it('protects a name word whose letter has no decomposed form, typed in plain letters', () => {
    expect(correct('vexmal').corrections).toEqual([]);
  });

  it('builds counts only from served rows but protects names from every row', () => {
    const mixed = buildSearchSpellingVocabulary([
      ...Array.from({ length: 10 }, () => ({
        nameText: [],
        bodyText: ['hidden topic krestology'],
        served: false,
      })),
      { nameText: ['Brindle Lab'], bodyText: [], served: false },
      ...repeat(5, { nameText: [], bodyText: ['brindles'] }),
    ]);
    expect(mixed.documentCount).toBe(5);
    expect(correctSearchQuerySpelling('krestolgy', mixed).corrections).toEqual([]);
    expect(correctSearchQuerySpelling('brindle', mixed).corrections).toEqual([]);
  });

  it('never rewrites a protected query term', () => {
    expect(correct('slep', new Set(['slep'])).corrections).toEqual([]);
  });

  it('leaves words of three letters or fewer alone', () => {
    expect(correct('bran').query).toBe('brain');
    expect(correct('brn').corrections).toEqual([]);
  });

  it('leaves a word alone when no corpus word is close enough', () => {
    expect(correct('zzzzqqq')).toEqual({ query: 'zzzzqqq', corrections: [] });
  });

  it('prefers the nearer candidate, then the more frequent one', () => {
    expect(correct('bain').query).toBe('brain');
  });

  it('breaks an exact tie alphabetically, so the correction does not depend on corpus order', () => {
    const tied = buildSearchSpellingVocabulary([
      ...repeat(5, { nameText: [], bodyText: ['cart'] }),
      ...repeat(5, { nameText: [], bodyText: ['card'] }),
    ]);
    expect(correctSearchQuerySpelling('carx', tied).query).toBe('card');
  });

  it('is a no-op without a vocabulary', () => {
    expect(correctSearchQuerySpelling('imunology', null)).toEqual({
      query: 'imunology',
      corrections: [],
    });
  });
});
