import { describe, expect, it } from 'vitest';
import {
  FACULTY_DIRECTORY_REGISTRY,
  getEvaluatedSkippedDirectories,
  getFacultyDirectoriesByCategory,
  getFacultyDirectoriesByStatus,
  getFacultyDirectoryGaps,
} from '../facultyDirectoryRegistry';
import { getSourceCoverage } from '../sourceCoverageRegistry';

const renderings = new Set(['static', 'js-rendered']);
const statuses = new Set(['covered', 'partial', 'gap', 'evaluated-skipped']);

describe('facultyDirectoryRegistry', () => {
  it('uses unique https directory URLs', () => {
    const urls = FACULTY_DIRECTORY_REGISTRY.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\//);
    }
  });

  it('uses only supported rendering, status, and tier values', () => {
    for (const entry of FACULTY_DIRECTORY_REGISTRY) {
      expect(renderings.has(entry.rendering), entry.url).toBe(true);
      expect(statuses.has(entry.status), entry.url).toBe(true);
      expect(entry.studentImpactTier, entry.url).toBeGreaterThanOrEqual(1);
      expect(entry.studentImpactTier, entry.url).toBeLessThanOrEqual(6);
    }
  });

  it('only references coveredBy sources that exist in the coverage registry', () => {
    for (const entry of FACULTY_DIRECTORY_REGISTRY) {
      for (const source of entry.coveredBy ?? []) {
        expect(getSourceCoverage(source), `${entry.url}:${source}`).toBeTruthy();
      }
    }
  });

  it('requires a coveredBy source for every covered directory', () => {
    for (const entry of getFacultyDirectoriesByStatus('covered')) {
      expect(entry.coveredBy && entry.coveredBy.length > 0, entry.url).toBe(true);
    }
  });

  it('classifies known covered departments and known gaps correctly', () => {
    const byUrl = new Map(FACULTY_DIRECTORY_REGISTRY.map((entry) => [entry.url, entry]));
    expect(byUrl.get('https://mcdb.yale.edu/people/faculty')?.status).toBe('covered');
    expect(byUrl.get('https://physics.yale.edu/people/faculty')?.status).toBe('covered');
    expect(byUrl.get('https://chem.yale.edu/people/faculty')?.status).toBe('covered');
    expect(byUrl.get('https://sociology.yale.edu/faculty')?.status).toBe('covered');
    expect(byUrl.get('https://english.yale.edu/people/ladder-faculty')?.status).toBe('covered');
    expect(
      byUrl.get('https://engineering.yale.edu/research-and-faculty/faculty-directory')?.status,
    ).toBe('covered');
  });

  it('models Yale-affiliated independent institutes as an evaluated, non-gap category', () => {
    const byUrl = new Map(FACULTY_DIRECTORY_REGISTRY.map((entry) => [entry.url, entry]));

    const haskins = byUrl.get('https://haskinslabs.org/people');
    expect(haskins?.directoryCategory).toBe('affiliated-institute');
    expect(haskins?.status).toBe('evaluated-skipped');
    expect(haskins?.coveredBy).toEqual(['ysm-faculty-directory']);
    expect(haskins?.notes).toMatch(/ysm-faculty-directory/i);

    const pierce = byUrl.get('https://jbpierce.org/directory/');
    expect(pierce?.directoryCategory).toBe('affiliated-institute');
    expect(pierce?.status).toBe('evaluated-skipped');
    expect(pierce?.coveredBy).toBeUndefined();
    expect(pierce?.notes).toMatch(/no.*research|administrative|board/i);

    const affiliated = getFacultyDirectoriesByCategory('affiliated-institute');
    expect(affiliated).toHaveLength(2);
    expect(new Set(affiliated.map((entry) => entry.url))).toEqual(
      new Set(['https://haskinslabs.org/people', 'https://jbpierce.org/directory/']),
    );
  });

  it('keeps evaluated-skipped directories out of the actionable gap queue', () => {
    const skipped = getEvaluatedSkippedDirectories();
    expect(skipped.length).toBeGreaterThan(0);
    for (const entry of skipped) {
      expect(entry.status).toBe('evaluated-skipped');
    }
    const gapUrls = new Set(getFacultyDirectoryGaps().map((entry) => entry.url));
    for (const entry of skipped) {
      expect(gapUrls.has(entry.url), entry.url).toBe(false);
    }
  });

  it('ranks gaps by student impact tier then faculty count', () => {
    const gaps = getFacultyDirectoryGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const entry of gaps) {
      expect(entry.status === 'gap' || entry.status === 'partial', entry.url).toBe(true);
    }
    for (let i = 1; i < gaps.length; i += 1) {
      const prev = gaps[i - 1];
      const curr = gaps[i];
      if (prev.studentImpactTier === curr.studentImpactTier) {
        expect(prev.approxFacultyCount ?? 0).toBeGreaterThanOrEqual(curr.approxFacultyCount ?? 0);
      } else {
        expect(prev.studentImpactTier).toBeLessThan(curr.studentImpactTier);
      }
    }
  });
});
