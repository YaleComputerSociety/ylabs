import { describe, expect, it } from 'vitest';

import { deriveFundingProgramTopic } from '../fundingProgramTopicDerivation';

describe('deriveFundingProgramTopic', () => {
  it('derives a research area from a named area-studies council', () => {
    expect(
      deriveFundingProgramTopic(
        'CMES Libby Rouse Fund for Peace Fellowships',
        'The Council on Middle East Studies invites applications...',
      ),
    ).toEqual({ department: undefined, researchArea: 'Middle Eastern Studies' });
  });

  it('derives European Studies from either the council or program name variant', () => {
    expect(
      deriveFundingProgramTopic(
        'European Studies Council - Fall Semester Travel/Conference Award',
        'It helps defray short-term research or conference travel costs related to Europe.',
      ).researchArea,
    ).toBe('European Studies');
    expect(
      deriveFundingProgramTopic(
        'European Union Studies Grants',
        'The European Union Studies Program of the MacMillan Center invites applications...',
      ).researchArea,
    ).toBe('European Studies');
  });

  it('derives a department from a named academic department fund', () => {
    expect(
      deriveFundingProgramTopic(
        'Department of Classics Undergraduate Summer Research and/or Travel Awards',
        'The Department of Classics will make available a limited number of awards...',
      ),
    ).toEqual({ department: 'Classics', researchArea: undefined });
  });

  it('derives a department from a description naming the field even when the title glues the acronym to another word', () => {
    expect(
      deriveFundingProgramTopic(
        'REEESNe Student Internship and Research Grant',
        'Supports eligible student internships or research connected to Russian, East European, and Eurasian studies.',
      ),
    ).toEqual({ department: 'Russian, East European, and Eurasian Studies', researchArea: undefined });
  });

  it('does not guess a topic from a bare region or subject mention', () => {
    expect(
      deriveFundingProgramTopic(
        'Robert Lyons Danly 1969 Memorial Travel Fellowship',
        'It supports Yale undergraduates pursuing summer research or independent study in Japan, excluding language study.',
      ),
    ).toEqual({});
  });

  it('returns nothing for genuinely cross-disciplinary residential college funds', () => {
    expect(
      deriveFundingProgramTopic(
        'Branford College Richter Summer Fellowship',
        'Funds a Richter Summer Fellowship for independent study and research by Branford College students.',
      ),
    ).toEqual({});
  });

  it('returns nothing when name and description are both empty', () => {
    expect(deriveFundingProgramTopic(undefined, undefined)).toEqual({});
  });
});
