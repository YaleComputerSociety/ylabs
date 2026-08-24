import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY,
  getDepartmentUndergradResearchPagesByStatus,
  getDepartmentUndergradResearchGaps,
  getEvaluatedSkippedDepartmentUndergradResearchPages,
} from '../departmentUndergradResearchSourceRegistry';
import { sourceCoverageRegistry } from '../sourceCoverageRegistry';
import { DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES } from '../sources/departmentUndergradResearchScraper';

const statuses = new Set(['covered', 'partial', 'gap', 'evaluated-skipped']);
const sourceNames = new Set(Object.keys(sourceCoverageRegistry));

describe('departmentUndergradResearchSourceRegistry', () => {
  it('uses unique https entry-point URLs', () => {
    const urls = DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\//);
    }
  });

  it('uses only supported status and impact-tier values', () => {
    for (const entry of DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY) {
      expect(statuses.has(entry.status), entry.url).toBe(true);
      expect(entry.impactTier, entry.url).toBeGreaterThanOrEqual(1);
      expect(entry.impactTier, entry.url).toBeLessThanOrEqual(5);
      expect(entry.department.length, entry.url).toBeGreaterThan(0);
      expect(entry.school.length, entry.url).toBeGreaterThan(0);
    }
  });

  it('only references coveredBy source names that exist in the source coverage registry', () => {
    for (const entry of DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY) {
      for (const source of entry.coveredBy ?? []) {
        expect(sourceNames.has(source), source).toBe(true);
      }
    }
  });

  it('requires a coveredByKey and coveredBy source for every covered page', () => {
    for (const entry of getDepartmentUndergradResearchPagesByStatus('covered')) {
      expect(entry.coveredByKey, entry.url).toBeTruthy();
      expect((entry.coveredBy ?? []).length, entry.url).toBeGreaterThan(0);
    }
  });

  it('never attaches a coveredByKey to a gap or evaluated-skipped page', () => {
    for (const entry of DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY) {
      if (entry.status === 'gap' || entry.status === 'evaluated-skipped') {
        expect(entry.coveredByKey, entry.url).toBeUndefined();
        expect(entry.coveredBy, entry.url).toBeUndefined();
      }
    }
  });

  it('represents every configured department page with a covered registry entry', () => {
    const coveredKeys = new Set(
      getDepartmentUndergradResearchPagesByStatus('covered').map((entry) => entry.coveredByKey),
    );
    for (const config of DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES) {
      expect(coveredKeys.has(config.key), config.key).toBe(true);
    }
  });

  it('backs every coveredByKey with a real configured department page', () => {
    const configKeys = new Set(DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((c) => c.key));
    for (const entry of getDepartmentUndergradResearchPagesByStatus('covered')) {
      expect(configKeys.has(entry.coveredByKey as string), entry.url).toBe(true);
    }
  });

  it('exposes at least one uncovered gap for a follow-up config row', () => {
    const gaps = getDepartmentUndergradResearchGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.status === 'gap' || gap.status === 'partial', gap.url).toBe(true);
    }
  });

  it('ranks gaps by student impact tier', () => {
    const gaps = getDepartmentUndergradResearchGaps();
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i - 1].impactTier).toBeLessThanOrEqual(gaps[i].impactTier);
    }
  });

  it('keeps evaluated-skipped pages distinct from gaps', () => {
    const skipped = getEvaluatedSkippedDepartmentUndergradResearchPages();
    const gapUrls = new Set(getDepartmentUndergradResearchGaps().map((entry) => entry.url));
    for (const entry of skipped) {
      expect(gapUrls.has(entry.url), entry.url).toBe(false);
    }
  });
});
