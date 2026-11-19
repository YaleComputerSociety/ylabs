import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildReviewSample, parseReviewSampleArgs } from '../officialUndergradListReviewSample';

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

describe('parseReviewSampleArgs --output', () => {
  it('resolves the report path through the shared report-path guard', () => {
    expect(parseReviewSampleArgs(['--output', '/tmp/sample.json']).output).toBe(
      path.resolve('/tmp/sample.json'),
    );
  });

  it('refuses a path outside the approved roots, a lookalike temp root, or a non-JSON file', () => {
    expect(() => parseReviewSampleArgs(['--output', path.resolve('src/sample.json')])).toThrow();
    expect(() => parseReviewSampleArgs(['--output', '/tmp-evil/sample.json'])).toThrow();
    expect(() => parseReviewSampleArgs(['--output', '/tmp/sample.txt'])).toThrow();
  });
});
