import { describe, expect, it } from 'vitest';
import {
  CENTERS_INSTITUTES_REGISTRY,
  getCentersInstitutesByStatus,
  getCenterCoverageGaps,
} from '../centersInstitutesRegistry';
import { DEFAULT_CENTER_CONFIGS } from '../sources/centersInstitutesScraper';

const renderings = new Set(['static', 'js-rendered']);
const statuses = new Set(['covered', 'partial', 'gap']);
const configuredKeys = new Set(DEFAULT_CENTER_CONFIGS.map((c) => c.centerKey));

describe('centersInstitutesRegistry', () => {
  it('uses unique https entry-point URLs', () => {
    const urls = CENTERS_INSTITUTES_REGISTRY.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\//);
    }
  });

  it('never persists the university-wide directory root as an entry point', () => {
    for (const entry of CENTERS_INSTITUTES_REGISTRY) {
      expect(entry.url, entry.url).not.toMatch(/research\.yale\.edu\/centers-institutes/);
      expect(entry.url, entry.url).not.toMatch(/yale\.edu\/about-yale\/centers-institutes/);
    }
  });

  it('uses only supported rendering, status, and tier values', () => {
    for (const entry of CENTERS_INSTITUTES_REGISTRY) {
      expect(renderings.has(entry.rendering), entry.url).toBe(true);
      expect(statuses.has(entry.status), entry.url).toBe(true);
      expect(entry.studentImpactTier, entry.url).toBeGreaterThanOrEqual(1);
      expect(entry.studentImpactTier, entry.url).toBeLessThanOrEqual(6);
    }
  });

  it('requires a coveredByCenterKey wired into DEFAULT_CENTER_CONFIGS for every covered center', () => {
    for (const entry of getCentersInstitutesByStatus('covered')) {
      expect(entry.coveredByCenterKey, entry.url).toBeTruthy();
      expect(configuredKeys.has(entry.coveredByCenterKey!), entry.coveredByCenterKey).toBe(true);
    }
  });

  it('only references coveredByCenterKey values that exist in DEFAULT_CENTER_CONFIGS', () => {
    for (const entry of CENTERS_INSTITUTES_REGISTRY) {
      if (entry.coveredByCenterKey) {
        expect(configuredKeys.has(entry.coveredByCenterKey), entry.coveredByCenterKey).toBe(true);
      }
    }
  });

  it('records every wired center config as a covered registry entry', () => {
    const coveredKeys = new Set(
      getCentersInstitutesByStatus('covered').map((entry) => entry.coveredByCenterKey),
    );
    for (const config of DEFAULT_CENTER_CONFIGS) {
      expect(coveredKeys.has(config.centerKey), config.centerKey).toBe(true);
    }
  });

  it('classifies the newly wired centers and known gaps correctly', () => {
    const byKey = new Map(
      CENTERS_INSTITUTES_REGISTRY.filter((e) => e.coveredByCenterKey).map((e) => [
        e.coveredByCenterKey,
        e,
      ]),
    );
    expect(byKey.get('qbio')?.status).toBe('covered');
    expect(byKey.get('dissc')?.status).toBe('covered');
    expect(byKey.get('wu-tsai')?.status).toBe('covered');

    const byUrl = new Map(CENTERS_INSTITUTES_REGISTRY.map((e) => [e.url, e]));
    expect(byUrl.get('https://westcampus.yale.edu/about-us/faculty')?.status).toBe('gap');
    expect(byUrl.get('https://ipch.yale.edu/people')?.status).toBe('gap');
    expect(byUrl.get('https://fds.yale.edu/people/')?.status).toBe('gap');
  });

  it('ranks gaps by student impact tier then member count', () => {
    const gaps = getCenterCoverageGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const entry of gaps) {
      expect(entry.status).not.toBe('covered');
    }
    for (let i = 1; i < gaps.length; i += 1) {
      const prev = gaps[i - 1];
      const curr = gaps[i];
      if (prev.studentImpactTier === curr.studentImpactTier) {
        expect(prev.approxMemberCount ?? 0).toBeGreaterThanOrEqual(curr.approxMemberCount ?? 0);
      } else {
        expect(prev.studentImpactTier).toBeLessThan(curr.studentImpactTier);
      }
    }
  });
});
