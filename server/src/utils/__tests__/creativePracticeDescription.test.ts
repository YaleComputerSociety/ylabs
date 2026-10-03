import { describe, expect, it } from 'vitest';
import {
  creativePracticeEvidence,
  decideCreativePractice,
  isArtsPracticeContext,
  statesResearchApartFromArtwork,
} from '../creativePracticeDescription';

const MUSIC = { departments: ['Music'], school: 'School of Music' };
const DRAMA_SCHOOL_ONLY = { departments: [], school: 'David Geffen School of Drama' };

describe('decideCreativePractice (#4519)', () => {
  it('labels a performance biography in an arts department', () => {
    const decision = decideCreativePractice({
      ...MUSIC,
      fullDescription:
        'A pianist who has performed with orchestras on four continents, she appears in recital each season and her recordings of the complete sonatas won a national award.',
    });

    expect(decision.creativePractice).toBe(true);
    expect(decision.evidence).toEqual(expect.arrayContaining(['performance', 'practitioner']));
  });

  it('reads the school when a drama row carries no department', () => {
    expect(
      decideCreativePractice({
        ...DRAMA_SCHOOL_ONLY,
        fullDescription:
          'He has directed productions on Broadway and at regional theaters, and his original plays have toured internationally.',
      }).creativePractice,
    ).toBe(true);
  });

  it('keeps arts research that states a research question as research', () => {
    for (const fullDescription of [
      'Her research examines how listeners perceive rhythm in orchestral music, and she has premiered new methods for studying concerts.',
      'A musicologist whose recordings and concerts are the subject of her monograph on nineteenth-century opera.',
      'The work combines music cognition experiments with performances in concert halls and recordings.',
      'He works in digital humanities, building archives of theater productions and performances.',
    ]) {
      expect(decideCreativePractice({ ...MUSIC, fullDescription }).creativePractice).toBe(false);
    }
  });

  it('treats a research-voice opening as a research statement', () => {
    expect(
      decideCreativePractice({
        ...MUSIC,
        fullDescription:
          'Studies recordings of contemporary vocal works and operatic compositions by living composers.',
      }).creativePractice,
    ).toBe(false);
  });

  it('does not read an artwork examining a theme as research', () => {
    expect(
      statesResearchApartFromArtwork(
        'Her work examines memory and duration through installations exhibited at galleries.',
      ),
    ).toBe(false);
    expect(
      decideCreativePractice({
        departments: ['Art'],
        fullDescription:
          'An artist whose work examines memory and duration through installations, she has exhibited at galleries in New York and Berlin.',
      }).creativePractice,
    ).toBe(true);
  });

  it('ignores the revoicer placeholder when it stands in for a name', () => {
    expect(
      decideCreativePractice({
        ...DRAMA_SCHOOL_ONLY,
        fullDescription:
          'This researcher is a festival dramaturg whose translations have been presented at national theaters and festivals.',
      }).creativePractice,
    ).toBe(true);
  });

  it('needs two kinds of practice evidence', () => {
    expect(creativePracticeEvidence('She teaches studio courses in painting.')).toEqual([]);
    expect(
      decideCreativePractice({
        ...MUSIC,
        fullDescription: 'He is in constant demand as a soloist.',
      }).creativePractice,
    ).toBe(false);
  });

  it('never labels a row outside an arts context', () => {
    expect(
      isArtsPracticeContext({ departments: ['Internal Medicine'], school: 'School of Medicine' }),
    ).toBe(false);
    expect(
      decideCreativePractice({
        departments: ['Internal Medicine'],
        fullDescription:
          'A pianist who has performed with orchestras on four continents and recorded the complete sonatas.',
      }).creativePractice,
    ).toBe(false);
  });

  it('reads the card only when no body serves', () => {
    expect(
      decideCreativePractice({
        ...MUSIC,
        shortDescription:
          'A violinist who has performed with major orchestras and premiered new concertos.',
      }).creativePractice,
    ).toBe(true);
    expect(
      decideCreativePractice({
        ...MUSIC,
        fullDescription: 'Her research focuses on the history of the violin concerto.',
        shortDescription:
          'A violinist who has performed with major orchestras and premiered new concertos.',
      }).creativePractice,
    ).toBe(false);
  });
});
