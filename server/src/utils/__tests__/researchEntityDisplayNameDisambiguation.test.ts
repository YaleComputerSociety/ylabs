import { describe, expect, it } from 'vitest';
import { disambiguateCollidingResearchEntityNames } from '../researchEntityDisplayNameDisambiguation';

describe('disambiguateCollidingResearchEntityNames', () => {
  it('appends the distinguishing department to colliding names', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The Liu Lab', departments: ['Microbial Pathogenesis'] },
      { name: 'The Liu Lab', departments: ['Biostatistics'] },
    ]);

    expect(entities.map((entity) => entity.name)).toEqual([
      'The Liu Lab (Microbial Pathogenesis)',
      'The Liu Lab (Biostatistics)',
    ]);
  });

  it('treats names as colliding regardless of whitespace and case', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The  Liu Lab', departments: ['Microbial Pathogenesis'] },
      { name: 'the liu lab', departments: ['Biostatistics'] },
    ]);

    expect(entities[0].name).toBe('The  Liu Lab (Microbial Pathogenesis)');
    expect(entities[1].name).toBe('the liu lab (Biostatistics)');
  });

  it('falls back to school when department does not distinguish', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The Chen Lab', departments: ['Immunobiology'], school: 'School of Medicine' },
      { name: 'The Chen Lab', departments: ['Immunobiology'], schools: ['Faculty of Arts and Sciences'] },
    ]);

    expect(entities.map((entity) => entity.name)).toEqual([
      'The Chen Lab (School of Medicine)',
      'The Chen Lab (Faculty of Arts and Sciences)',
    ]);
  });

  it('leaves names unchanged when no field can distinguish them', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The Chen Lab', departments: ['Immunobiology'], school: 'School of Medicine' },
      { name: 'The Chen Lab', departments: ['Immunobiology'], school: 'School of Medicine' },
    ]);

    expect(entities.every((entity) => entity.name === 'The Chen Lab')).toBe(true);
  });

  it('does not decorate a name when only one colliding entity has a usable label', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The Chen Lab', departments: ['Immunobiology'] },
      { name: 'The Chen Lab' },
    ]);

    expect(entities.map((entity) => entity.name)).toEqual(['The Chen Lab', 'The Chen Lab']);
  });

  it('leaves unique names untouched', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: 'The Solo Lab', departments: ['Physics'] },
      { name: 'The Other Lab', departments: ['Chemistry'] },
    ]);

    expect(entities.map((entity) => entity.name)).toEqual(['The Solo Lab', 'The Other Lab']);
  });

  it('ignores empty names', () => {
    const entities = disambiguateCollidingResearchEntityNames([
      { name: '', departments: ['Physics'] },
      { name: '', departments: ['Chemistry'] },
    ]);

    expect(entities.map((entity) => entity.name)).toEqual(['', '']);
  });
});
