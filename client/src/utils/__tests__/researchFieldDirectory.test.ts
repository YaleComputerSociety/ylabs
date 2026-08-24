import { describe, expect, it } from 'vitest';
import { buildResearchFieldDirectory } from '../researchFieldDirectory';

const fieldOrder = ['Computing & AI', 'Life Sciences', 'Humanities & Arts'];

const fieldByName: Record<string, string> = {
  'Machine Learning': 'Computing & AI',
  Robotics: 'Computing & AI',
  Genomics: 'Life Sciences',
  Neuroscience: 'Life Sciences',
  'Art History': 'Humanities & Arts',
};

const colorByField: Record<string, string> = {
  'Computing & AI': 'blue',
  'Life Sciences': 'green',
  'Humanities & Arts': 'pink',
};

const build = (areaOptions: Array<{ value: string; count?: number }>) =>
  buildResearchFieldDirectory({
    areaOptions,
    fieldForArea: (name) => fieldByName[name],
    fieldOrder,
    colorKeyForField: (field) => colorByField[field],
  });

describe('buildResearchFieldDirectory', () => {
  it('groups areas under their configured field and orders domains by fieldOrder', () => {
    const domains = build([
      { value: 'Genomics', count: 5 },
      { value: 'Machine Learning', count: 9 },
      { value: 'Art History', count: 2 },
    ]);

    expect(domains.map((domain) => domain.field)).toEqual([
      'Computing & AI',
      'Life Sciences',
      'Humanities & Arts',
    ]);
    expect(domains[0].colorKey).toBe('blue');
  });

  it('sorts areas within a domain by count descending then name', () => {
    const domains = build([
      { value: 'Robotics', count: 3 },
      { value: 'Machine Learning', count: 9 },
    ]);

    expect(domains[0].areas.map((area) => area.name)).toEqual(['Machine Learning', 'Robotics']);
  });

  it('excludes areas with zero, missing, or non-finite counts', () => {
    const domains = build([
      { value: 'Machine Learning', count: 0 },
      { value: 'Robotics' },
      { value: 'Genomics', count: Number.NaN },
      { value: 'Neuroscience', count: 4 },
    ]);

    expect(domains).toHaveLength(1);
    expect(domains[0].field).toBe('Life Sciences');
    expect(domains[0].areas.map((area) => area.name)).toEqual(['Neuroscience']);
  });

  it('drops areas that do not resolve to a configured field', () => {
    const domains = build([
      { value: 'Uncanonicalized Junk', count: 12 },
      { value: 'Genomics', count: 4 },
    ]);

    expect(domains).toHaveLength(1);
    expect(domains[0].areas.map((area) => area.name)).toEqual(['Genomics']);
  });

  it('appends fields missing from fieldOrder after ordered ones, alphabetically', () => {
    const domains = buildResearchFieldDirectory({
      areaOptions: [
        { value: 'Machine Learning', count: 2 },
        { value: 'Zoology', count: 2 },
        { value: 'Astronomy', count: 2 },
      ],
      fieldForArea: (name) =>
        ({ 'Machine Learning': 'Computing & AI', Zoology: 'Zoology Field', Astronomy: 'Astro Field' })[
          name
        ],
      fieldOrder,
      colorKeyForField: () => undefined,
    });

    expect(domains.map((domain) => domain.field)).toEqual([
      'Computing & AI',
      'Astro Field',
      'Zoology Field',
    ]);
    expect(domains[1].colorKey).toBe('gray');
  });
});
