import { describe, expect, it } from 'vitest';
import {
  FELLOWSHIP_PROGRAM_SOURCE_REGISTRY,
  getFellowshipProgramCatalogsByStatus,
  getFellowshipProgramCatalogGaps,
  getEvaluatedSkippedFellowshipCatalogs,
} from '../fellowshipProgramSourceRegistry';
import { sourceCoverageRegistry } from '../sourceCoverageRegistry';
import {
  DEFAULT_PAGE_URLS,
  FUNDING_YALE_SITEMAP_URLS,
} from '../sources/yaleCollegeFellowshipsOfficeScraper';
import { isProgramApplicationPortalUrl } from '../../utils/researchHomeWebsiteUrl';

const statuses = new Set(['covered', 'partial', 'gap', 'evaluated-skipped']);
const sourceNames = new Set(Object.keys(sourceCoverageRegistry));

function withoutQuery(url: string): string {
  return url.split('?')[0];
}

describe('fellowshipProgramSourceRegistry', () => {
  it('uses unique https entry-point URLs', () => {
    const urls = FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\//);
    }
  });

  it('uses only supported status and impact-tier values', () => {
    for (const entry of FELLOWSHIP_PROGRAM_SOURCE_REGISTRY) {
      expect(statuses.has(entry.status), entry.url).toBe(true);
      expect(entry.impactTier, entry.url).toBeGreaterThanOrEqual(1);
      expect(entry.impactTier, entry.url).toBeLessThanOrEqual(5);
      expect(entry.catalogName.length, entry.url).toBeGreaterThan(0);
      expect(entry.owningOffice.length, entry.url).toBeGreaterThan(0);
    }
  });

  it('only references coveredBy source names that exist in the source coverage registry', () => {
    for (const entry of FELLOWSHIP_PROGRAM_SOURCE_REGISTRY) {
      for (const source of entry.coveredBy ?? []) {
        expect(sourceNames.has(source), source).toBe(true);
      }
    }
  });

  it('requires a coveredBy source for every covered catalog', () => {
    for (const entry of getFellowshipProgramCatalogsByStatus('covered')) {
      expect((entry.coveredBy ?? []).length, entry.url).toBeGreaterThan(0);
    }
  });

  it('never attaches a coveredBy source to a gap or evaluated-skipped catalog', () => {
    for (const entry of FELLOWSHIP_PROGRAM_SOURCE_REGISTRY) {
      if (entry.status === 'gap' || entry.status === 'evaluated-skipped') {
        expect(entry.coveredBy, entry.url).toBeUndefined();
      }
    }
  });

  it('backs every covered catalog with a fellowships-office seed or sitemap crawl', () => {
    const sitemapHosts = new Set(
      FUNDING_YALE_SITEMAP_URLS.map((url) => new URL(url).hostname.toLowerCase()),
    );
    for (const entry of getFellowshipProgramCatalogsByStatus('covered')) {
      const seeded = (DEFAULT_PAGE_URLS as readonly string[]).includes(entry.url);
      const sitemapCovered = sitemapHosts.has(new URL(entry.url).hostname.toLowerCase());
      expect(seeded || sitemapCovered, entry.url).toBe(true);
      expect(entry.coveredBy, entry.url).toContain('yale-college-fellowships-office');
    }
  });

  it('represents every seeded fellowships-office page with a covered catalog entry', () => {
    const coveredUrls = getFellowshipProgramCatalogsByStatus('covered').map((entry) => entry.url);
    for (const seed of DEFAULT_PAGE_URLS) {
      const base = withoutQuery(seed);
      const represented = coveredUrls.some(
        (coveredUrl) => base === coveredUrl || base.startsWith(`${coveredUrl}/`),
      );
      expect(represented, seed).toBe(true);
    }
  });

  it('records gated application portals as evaluated-skipped, never as gaps', () => {
    const skipped = getEvaluatedSkippedFellowshipCatalogs();
    expect(skipped.length).toBeGreaterThan(0);
    for (const entry of skipped) {
      expect(isProgramApplicationPortalUrl(entry.url), entry.url).toBe(true);
    }
    for (const gap of getFellowshipProgramCatalogGaps()) {
      expect(isProgramApplicationPortalUrl(gap.url), gap.url).toBe(false);
    }
  });

  it('enumerates the known-uncovered public catalogs as gaps', () => {
    const gapUrls = new Set(getFellowshipProgramCatalogGaps().map((entry) => entry.url));
    expect(gapUrls.has('https://macmillan.yale.edu/undergraduate-research-grants')).toBe(true);
  });

  it('marks the Yale College student-faculty awards index as covered by the fellowships-office crawl', () => {
    const awardsIndex = FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.find(
      (entry) => entry.url === 'https://college.yale.edu/life-at-yale/student-faculty-awards',
    );
    expect(awardsIndex?.status).toBe('covered');
    expect(awardsIndex?.coveredBy).toContain('yale-college-fellowships-office');
    const gapUrls = new Set(getFellowshipProgramCatalogGaps().map((entry) => entry.url));
    expect(gapUrls.has('https://college.yale.edu/life-at-yale/student-faculty-awards')).toBe(false);
  });

  it('marks the STEM fellowships hub as covered and retires its child-pages gap', () => {
    const stemHub = FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.find(
      (entry) =>
        entry.url ===
        'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale',
    );
    expect(stemHub?.status).toBe('covered');
    expect(stemHub?.coveredBy).toContain('yale-college-fellowships-office');
    const urls = FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.map((entry) => entry.url);
    expect(
      urls.includes(
        'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/children',
      ),
    ).toBe(false);
  });

  it('marks the full find-funding database as covered by the sitemap-driven crawl', () => {
    const findFunding = FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.find(
      (entry) => entry.url === 'https://funding.yale.edu/find-funding',
    );
    expect(findFunding?.status).toBe('covered');
    expect(findFunding?.coveredBy).toContain('yale-college-fellowships-office');
    const gapUrls = new Set(getFellowshipProgramCatalogGaps().map((entry) => entry.url));
    expect(gapUrls.has('https://funding.yale.edu/find-funding')).toBe(false);
  });

  it('ranks gaps by student impact tier then discoverable program count', () => {
    const gaps = getFellowshipProgramCatalogGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const entry of gaps) {
      expect(entry.status === 'gap' || entry.status === 'partial', entry.url).toBe(true);
    }
    for (let i = 1; i < gaps.length; i += 1) {
      const prev = gaps[i - 1];
      const curr = gaps[i];
      if (prev.impactTier === curr.impactTier) {
        expect(prev.approxProgramCount ?? 0).toBeGreaterThanOrEqual(curr.approxProgramCount ?? 0);
      } else {
        expect(prev.impactTier).toBeLessThan(curr.impactTier);
      }
    }
  });
});
