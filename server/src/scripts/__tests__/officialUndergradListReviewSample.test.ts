import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildReviewSample,
  resolveReviewSampleOutputPath,
  reviewSampleOutputRoots,
} from '../officialUndergradListReviewSample';

const SOURCE = 'theater-performance-studies-senior-projects';
const INDEX = 'https://tdps.example.edu/archive';

const listing = (adviserName: string, year: number, itemKey: string) => ({
  source: SOURCE,
  adviserName,
  year,
  itemKey,
  sourceUrl: INDEX,
  studentName: 'Juniper Talloway',
  projectTitle: 'A Synthetic Play',
});

describe('buildReviewSample', () => {
  const matches = [
    {
      listing: listing('Rowan Synthetic', 2024, 'card:1'),
      resolution: {
        status: 'matched',
        slug: 'synthetic-lab',
        researcherId: 'researcher-1',
        researcherName: 'Rowan Synthetic',
        matchedBy: 'name',
      },
    },
    {
      listing: listing('Rowan Synthetic', 2023, 'card:2'),
      resolution: {
        status: 'matched',
        slug: 'synthetic-lab',
        researcherId: 'researcher-1',
        researcherName: 'Rowan Synthetic',
        matchedBy: 'name',
      },
    },
    {
      listing: listing('Harper Invented', 2025, 'card:3'),
      resolution: { status: 'refused', reason: 'department-mismatch' },
    },
  ] as any;

  const { samples, refused } = buildReviewSample({
    matches,
    rowBySlug: new Map([
      ['synthetic-lab', { displayName: 'Synthetic Lab', departments: ['Theater Studies'] }],
    ]),
    researcherById: new Map([
      [
        'researcher-1',
        { displayName: 'Rowan Q. Synthetic', profile: { primaryDepartment: 'Theater Studies' } },
      ],
    ]),
    perSource: 10,
  });

  it('records the years and the matched researcher of each match once', () => {
    expect(samples[SOURCE]).toEqual([
      expect.objectContaining({
        listedAs: 'Rowan Synthetic',
        listedOn: INDEX,
        years: [2023, 2024],
        matchedResearcher: 'Rowan Q. Synthetic',
        matchedResearcherId: 'researcher-1',
        matchedResearcherDepartment: 'Theater Studies',
        row: expect.objectContaining({ slug: 'synthetic-lab', title: 'Synthetic Lab' }),
      }),
    ]);
  });

  it('records each refused adviser with its year and reason', () => {
    expect(refused[SOURCE]).toEqual([
      {
        listedAs: 'Harper Invented',
        listedDepartment: null,
        year: 2025,
        listedOn: INDEX,
        reason: 'department-mismatch',
      },
    ]);
  });

  it('copies nothing a listing carries about a student', () => {
    expect(JSON.stringify({ samples, refused })).not.toMatch(
      /Juniper|Talloway|Synthetic Play|studentName|projectTitle|itemKey|card:/,
    );
  });
});

describe('resolveReviewSampleOutputPath', () => {
  const roots = reviewSampleOutputRoots('/work/server', '/home/someone');

  it('writes only under ./tmp, /tmp or the private experiments folder', () => {
    expect(roots).toEqual([
      path.resolve('/work/server/tmp'),
      path.resolve('/tmp'),
      path.resolve('/home/someone/Personal/ylabs-experiments'),
    ]);
    expect(resolveReviewSampleOutputPath('/tmp/sample.json', roots)).toBe(
      path.resolve('/tmp/sample.json'),
    );
    expect(
      resolveReviewSampleOutputPath('/home/someone/Personal/ylabs-experiments/5839/s.json', roots),
    ).toBe(path.resolve('/home/someone/Personal/ylabs-experiments/5839/s.json'));
    expect(resolveReviewSampleOutputPath('/work/server/tmp/s.json', roots)).toBe(
      path.resolve('/work/server/tmp/s.json'),
    );
  });

  it('refuses a path outside those roots, even an approved temp root', () => {
    expect(() => resolveReviewSampleOutputPath('/work/server/src/sample.json', roots)).toThrow();
    expect(() => resolveReviewSampleOutputPath('/tmp-evil/sample.json', roots)).toThrow();
    expect(() => resolveReviewSampleOutputPath('/tmp/sample.txt', roots)).toThrow();
  });
});
