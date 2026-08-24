import { describe, expect, it } from 'vitest';
import {
  isActiveEngagementIntent,
  isStudentEngagementIntent,
  personalizeBrowseHits,
  researchHomeMatchesEngagementIntent,
  researchInterestMatchScore,
  normalizeResearchInterestTerm,
} from '../researchInterestPersonalization';

const hit = (id: string, browseRankScore: number, researchAreas: string[] = []) => ({
  id,
  browseRankScore,
  researchAreas,
});

describe('normalizeResearchInterestTerm', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeResearchInterestTerm('  Machine   Learning ')).toBe('machine learning');
    expect(normalizeResearchInterestTerm("Women's Health")).toBe('womens health');
    expect(normalizeResearchInterestTerm(42 as unknown as string)).toBe('');
  });
});

describe('researchInterestMatchScore', () => {
  it('counts distinct declared interests present across governed fields', () => {
    const entity = {
      researchAreas: ['Machine Learning'],
      departments: ['Statistics'],
      studentSearchTerms: ['neural networks'],
      topics: [],
    };
    const interests = new Set(['machine learning', 'statistics', 'oceanography']);
    expect(researchInterestMatchScore(entity, interests)).toBe(2);
  });

  it('never rewards an interest that matches no corpus term (graceful degrade)', () => {
    const entity = { researchAreas: ['Cell Biology'] };
    expect(researchInterestMatchScore(entity, new Set(['quantum gravity']))).toBe(0);
  });
});

describe('isStudentEngagementIntent / isActiveEngagementIntent', () => {
  it('recognizes governed intents and rejects everything else', () => {
    expect(isStudentEngagementIntent('ra-position')).toBe(true);
    expect(isStudentEngagementIntent('exploring')).toBe(true);
    expect(isStudentEngagementIntent('mentorship')).toBe(false);
    expect(isStudentEngagementIntent(undefined)).toBe(false);
  });

  it('treats only a non-exploring governed intent as active', () => {
    expect(isActiveEngagementIntent('thesis-advisor')).toBe(true);
    expect(isActiveEngagementIntent('exploring')).toBe(false);
    expect(isActiveEngagementIntent('bogus')).toBe(false);
  });
});

describe('researchHomeMatchesEngagementIntent', () => {
  it('matches ra-position on paid compensation, a posted opening, or an RA program', () => {
    expect(
      researchHomeMatchesEngagementIntent(
        { undergraduateCompensationModel: 'PAID_OR_STIPEND' },
        'ra-position',
      ),
    ).toBe(true);
    expect(
      researchHomeMatchesEngagementIntent(
        { undergraduateCurrentAvailability: 'OPEN' },
        'ra-position',
      ),
    ).toBe(true);
    expect(researchHomeMatchesEngagementIntent({ entityType: 'RA_PROGRAM' }, 'ra-position')).toBe(
      true,
    );
    expect(
      researchHomeMatchesEngagementIntent(
        { entityType: 'LAB', undergraduateCompensationModel: 'UNKNOWN' },
        'ra-position',
      ),
    ).toBe(false);
  });

  it('matches thesis-advisor on faculty-led and course-sequence homes only', () => {
    expect(researchHomeMatchesEngagementIntent({ entityType: 'LAB' }, 'thesis-advisor')).toBe(true);
    expect(
      researchHomeMatchesEngagementIntent({ entityType: 'FACULTY_RESEARCH_AREA' }, 'thesis-advisor'),
    ).toBe(true);
    expect(researchHomeMatchesEngagementIntent({ entityType: 'CENTER' }, 'thesis-advisor')).toBe(
      false,
    );
  });

  it('matches independent-study on course sequences or course-credit compensation', () => {
    expect(
      researchHomeMatchesEngagementIntent({ entityType: 'COURSE_SEQUENCE' }, 'independent-study'),
    ).toBe(true);
    expect(
      researchHomeMatchesEngagementIntent(
        { undergraduateCompensationModel: 'COURSE_CREDIT' },
        'independent-study',
      ),
    ).toBe(true);
    expect(researchHomeMatchesEngagementIntent({ entityType: 'LAB' }, 'independent-study')).toBe(
      false,
    );
  });

  it('never matches when exploring or intent is absent', () => {
    expect(researchHomeMatchesEngagementIntent({ entityType: 'LAB' }, 'exploring')).toBe(false);
    expect(researchHomeMatchesEngagementIntent({ entityType: 'LAB' }, undefined)).toBe(false);
  });
});

describe('personalizeBrowseHits', () => {
  it('is byte-for-byte identity when there are no declared interests', () => {
    const hits = [hit('a', 9), hit('b', 8), hit('c', 7)];
    expect(personalizeBrowseHits(hits, { interests: [] })).toEqual(hits);
  });

  it('is identity when no home in the pool matches any interest', () => {
    const hits = [hit('a', 9, ['History']), hit('b', 8, ['Art History'])];
    const result = personalizeBrowseHits(hits, { interests: ['Machine Learning'] });
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('floats interest matches up while preserving browse order within a tier', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['Machine Learning']),
      hit('c', 7, ['Robotics']),
      hit('d', 6, ['Machine Learning']),
    ];
    const result = personalizeBrowseHits(hits, { interests: ['Machine Learning'] });
    expect(result.map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('ranks a stronger overlap above a weaker one, then falls back to browse order', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['Machine Learning']),
      hit('c', 7, ['Machine Learning', 'Statistics']),
    ];
    const result = personalizeBrowseHits(hits, {
      interests: ['Machine Learning', 'Statistics'],
    });
    expect(result.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('reorders only within the fixed pool so pagination past it stays stable', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['History']),
      hit('c', 7, ['Machine Learning']),
    ];
    const result = personalizeBrowseHits(hits, { interests: ['Machine Learning'] }, 2);
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('is a pure permutation that never mutates the hit objects or their scores', () => {
    const hits = [hit('a', 9, ['History']), hit('b', 8, ['Machine Learning'])];
    const snapshot = hits.map((entry) => ({ ...entry }));
    const result = personalizeBrowseHits(hits, { interests: ['Machine Learning'] });
    expect(new Set(result)).toEqual(new Set(hits));
    expect(result.every((entry) => hits.includes(entry))).toBe(true);
    expect(hits).toEqual(snapshot);
  });

  it('is identity for exploring intent with no interests (no personalization regression)', () => {
    const hits = [
      { id: 'a', entityType: 'LAB' },
      { id: 'b', entityType: 'COURSE_SEQUENCE' },
    ];
    expect(personalizeBrowseHits(hits, { lookingFor: 'exploring' })).toEqual(hits);
    expect(personalizeBrowseHits(hits, {})).toEqual(hits);
  });

  it('floats intent-matching homes up while non-matching homes keep global order', () => {
    const hits = [
      { id: 'a', entityType: 'CENTER' },
      { id: 'b', entityType: 'LAB' },
      { id: 'c', entityType: 'INSTITUTE' },
      { id: 'd', entityType: 'FACULTY_RESEARCH_AREA' },
    ];
    const result = personalizeBrowseHits(hits, { lookingFor: 'thesis-advisor' });
    expect(result.map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('breaks equal-interest ties by intent match, floating the matching home above', () => {
    const hits = [
      { id: 'a', browseRankScore: 9, researchAreas: ['History'], entityType: 'CENTER' },
      {
        id: 'b',
        browseRankScore: 8,
        researchAreas: ['Machine Learning'],
        entityType: 'CENTER',
      },
      {
        id: 'c',
        browseRankScore: 7,
        researchAreas: ['Machine Learning'],
        entityType: 'LAB',
      },
    ];
    const result = personalizeBrowseHits(hits, {
      interests: ['Machine Learning'],
      lookingFor: 'thesis-advisor',
    });
    expect(result.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps interest overlap dominant over intent match', () => {
    const hits = [
      { id: 'a', browseRankScore: 9, researchAreas: ['History'], entityType: 'LAB' },
      {
        id: 'b',
        browseRankScore: 8,
        researchAreas: ['Machine Learning'],
        entityType: 'CENTER',
      },
    ];
    const result = personalizeBrowseHits(hits, {
      interests: ['Machine Learning'],
      lookingFor: 'thesis-advisor',
    });
    expect(result.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});
