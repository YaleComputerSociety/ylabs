import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_LANE_SOURCE_NAME,
  descriptionStatesResearchArea,
  storedServedDescription,
  withResearchAreasGroundedInStoredDescription,
} from '../researchAreasGroundedInDescription';

const description = [
  'The group studies how coastal kelp forests recover after marine heatwaves.',
  'Lab life: journal club; field trips; outreach days',
].join('\n');

describe('descriptionStatesResearchArea (#6360)', () => {
  it('finds every content word of the topic inside one prose sentence', () => {
    expect(descriptionStatesResearchArea('Kelp Forests', description)).toBe(true);
    expect(descriptionStatesResearchArea('Recovery of Kelp', description)).toBe(true);
  });

  it('matches an inverted MeSH heading against natural word order', () => {
    const prose = 'The lab studies innate immunity in hepatocellular carcinoma.';
    expect(descriptionStatesResearchArea('Carcinoma, Hepatocellular', prose)).toBe(true);
    expect(descriptionStatesResearchArea('Immunity, Innate', prose)).toBe(true);
  });

  it('never reads a topic off a semicolon list line', () => {
    expect(descriptionStatesResearchArea('Journal Club', description)).toBe(false);
  });

  it('never reads a topic off a labelled or unpunctuated comma list line', () => {
    expect(descriptionStatesResearchArea('Kelp Forests', 'Keywords: kelp forests, heatwaves')).toBe(
      false,
    );
    expect(
      descriptionStatesResearchArea('Kelp Forests', 'kelp forests, heatwaves, tides, storms'),
    ).toBe(false);
    expect(
      descriptionStatesResearchArea(
        'Kelp Forests',
        'We study kelp forests, tides, storms, and surf.',
      ),
    ).toBe(true);
    expect(
      descriptionStatesResearchArea('Kelp Forests', 'Overview: the lab studies kelp forests.'),
    ).toBe(true);
  });

  it('needs the words in the same sentence', () => {
    expect(
      descriptionStatesResearchArea('Kelp Ecology', 'We study kelp. Ecology is taught elsewhere.'),
    ).toBe(false);
  });

  it('rejects a non-string or a stop-word-only topic', () => {
    expect(descriptionStatesResearchArea({ name: 'Kelp' }, description)).toBe(false);
    expect(descriptionStatesResearchArea('of the', description)).toBe(false);
  });
});

describe('withResearchAreasGroundedInStoredDescription (#6360)', () => {
  it('keeps only the description lane values the description states and passes other fields through', () => {
    const observations = [
      {
        field: 'researchAreas',
        sourceName: DESCRIPTION_LANE_SOURCE_NAME,
        value: ['Kelp Forests', 'Journal Club'],
      },
      { field: 'researchAreas', sourceName: 'ysm-mesh-keyword', value: ['Kelp Forests'] },
      {
        field: 'researchAreas',
        sourceName: DESCRIPTION_LANE_SOURCE_NAME,
        value: ['Outreach Days'],
      },
      { field: 'websiteUrl', sourceName: 'lab-site', value: 'https://example.org/' },
    ];

    expect(withResearchAreasGroundedInStoredDescription(observations, description)).toEqual([
      { field: 'researchAreas', sourceName: DESCRIPTION_LANE_SOURCE_NAME, value: ['Kelp Forests'] },
      { field: 'websiteUrl', sourceName: 'lab-site', value: 'https://example.org/' },
    ]);
  });
});

describe('storedServedDescription', () => {
  it('joins the stored short and full descriptions, skipping blanks', () => {
    expect(storedServedDescription({ shortDescription: 'A.', fullDescription: '  ' })).toBe('A.');
    expect(storedServedDescription(null)).toBe('');
  });
});
