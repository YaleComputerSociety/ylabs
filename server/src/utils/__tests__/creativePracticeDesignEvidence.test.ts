import { describe, expect, it } from 'vitest';
import {
  decideCreativePractice,
  statesResearchApartFromArtwork,
} from '../creativePracticeDescription';

const MUSIC = {
  entityType: 'FACULTY_RESEARCH_AREA',
  departments: ['Music'],
  school: 'School of Music',
};
const ART_SCHOOL_ONLY = {
  entityType: 'FACULTY_RESEARCH_AREA',
  departments: [],
  school: 'School of Art',
};

describe('decideCreativePractice design and instrument evidence (#4551)', () => {
  it('reads design practice and a founded practice organization as two kinds', () => {
    const decision = decideCreativePractice({
      ...ART_SCHOOL_ONLY,
      fullDescription:
        'She is the co-founder of Northfield Type, an independent type foundry, and has drawn typefaces for publishers and museums.',
    });
    expect(decision.creativePractice).toBe(true);
    expect(decision.evidence).toEqual(expect.arrayContaining(['design', 'practitioner']));
  });

  it('reads an instrument named beside a production as practice', () => {
    const decision = decideCreativePractice({
      ...MUSIC,
      fullDescription:
        'Explores the capabilities of the bassoon with students and oversees the production of a series of new reed designs.',
    });
    expect(decision.creativePractice).toBe(true);
    expect(decision.evidence).toEqual(expect.arrayContaining(['instrument', 'production']));
  });

  it('reads presenting research at a design conference as a talk, not a research claim', () => {
    expect(
      statesResearchApartFromArtwork(
        'He shares his story and research at design conferences worldwide.',
      ),
    ).toBe(false);
    expect(
      statesResearchApartFromArtwork('Her research on letterforms appears in design journals.'),
    ).toBe(true);
  });

  it('keeps a single design mention, or an instrument studied as research, as research', () => {
    for (const fullDescription of [
      'He teaches graphic design to undergraduates.',
      'Her research examines the acoustics of the organ in historic churches.',
      'A historian of typography whose monograph traces the history of the printed letter.',
    ]) {
      expect(
        decideCreativePractice({ ...ART_SCHOOL_ONLY, fullDescription }).creativePractice,
      ).toBe(false);
    }
  });
});
