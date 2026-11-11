import { describe, expect, it } from 'vitest';
import {
  centerTitleInitialisms,
  centerTitleSearchPhrase,
  collectCenterTitleInitialismCandidates,
  resolveCenterInitialismTable,
} from '../centerTitleInitialisms';

const noGuardFails = {
  isReservedQueryWord: () => false,
  isEnglishWord: () => false,
  isCorpusWord: () => false,
};

describe('centerTitleInitialisms', () => {
  it('takes the first letter of each significant word, with and without the Yale letter', () => {
    expect(centerTitleInitialisms('Yale Center for Coastal Tide Studies')).toEqual([
      'yccts',
      'ccts',
    ]);
    expect(centerTitleInitialisms('Center for Lunar and Polar Modelling at Yale')).toEqual([
      'clpmy',
      'clpm',
    ]);
  });

  it('drops function words, parentheticals, a one-word label and splits hyphenated words', () => {
    expect(centerTitleInitialisms('Institute of the Tide and the Moon')).toEqual(['itm']);
    expect(centerTitleInitialisms('Affiliated: Quiet Harbor Institute (QHI)')).toEqual(['qhi']);
    expect(centerTitleInitialisms('Data-Rich Moss Center')).toEqual(['drmc']);
    expect(centerTitleSearchPhrase('Affiliated: Quiet Harbor Institute (QHI)')).toBe(
      'Quiet Harbor Institute',
    );
  });

  it('offers nothing shorter than three letters or longer than eight', () => {
    expect(centerTitleInitialisms('Yale Moss Institute')).toEqual(['ymi']);
    expect(centerTitleInitialisms('Moss Center')).toEqual([]);
    expect(
      centerTitleInitialisms('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Center'),
    ).toEqual([]);
  });
});

describe('collectCenterTitleInitialismCandidates', () => {
  it('reads only served centers and institutes, keyed by their search phrase', () => {
    const candidates = collectCenterTitleInitialismCandidates([
      { titles: ['Quiet Harbor Institute'], entityType: 'INSTITUTE', served: true },
      { titles: ['Quiet Harbor Institute'], entityType: 'INSTITUTE', served: true },
      { titles: ['Lunar Moss Center'], entityType: 'CENTER', served: false },
      { titles: ['Tidal Moss Lab'], entityType: 'LAB', served: true },
    ]);
    expect([...candidates.keys()]).toEqual(['qhi']);
    expect([...candidates.get('qhi')!]).toEqual(['Quiet Harbor Institute']);
  });
});

describe('resolveCenterInitialismTable', () => {
  it('rewrites a unique initialism and counts each refusal under its first failing guard', () => {
    const candidates = collectCenterTitleInitialismCandidates([
      { titles: ['Quiet Harbor Institute'], entityType: 'INSTITUTE', served: true },
      { titles: ['Lunar Moss Center'], entityType: 'CENTER', served: true },
      { titles: ['Lichen Moss Center'], entityType: 'CENTER', served: true },
      { titles: ['Copper Arc Tide Center'], entityType: 'CENTER', served: true },
      { titles: ['Nordic Lake Polar Center'], entityType: 'CENTER', served: true },
      { titles: ['Tidal Rock Institute'], entityType: 'INSTITUTE', served: true },
    ]);
    const table = resolveCenterInitialismTable(candidates, {
      isReservedQueryWord: (word) => word === 'nlpc',
      isEnglishWord: (word) => word === 'catc',
      isCorpusWord: (word) => word === 'tri',
    });

    expect([...table.phraseByInitialism]).toEqual([['qhi', 'Quiet Harbor Institute']]);
    expect(table.refusals).toEqual({
      namesSeveralCenters: 1,
      reservedQueryWord: 1,
      englishWord: 1,
      corpusWord: 1,
    });
  });

  it('treats one title shared by several rows as one center', () => {
    const candidates = collectCenterTitleInitialismCandidates([
      { titles: ['Quiet Harbor Institute'], entityType: 'INSTITUTE', served: true },
      { titles: ['quiet harbor institute'], entityType: 'INSTITUTE', served: true },
    ]);
    expect(
      resolveCenterInitialismTable(candidates, noGuardFails).phraseByInitialism.get('qhi'),
    ).toBe('Quiet Harbor Institute');
  });
});
