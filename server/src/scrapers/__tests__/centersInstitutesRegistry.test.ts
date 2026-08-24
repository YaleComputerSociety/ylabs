import { describe, expect, it } from 'vitest';
import {
  CENTERS_INSTITUTES_REGISTRY,
  getCentersInstitutesByStatus,
  getCenterCoverageGaps,
} from '../centersInstitutesRegistry';
import { DEFAULT_CENTER_CONFIGS } from '../sources/centersInstitutesScraper';

const renderings = new Set(['static', 'js-rendered']);
const statuses = new Set(['covered', 'partial', 'gap', 'evaluated-skipped']);
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
    expect(byKey.get('fds')?.status).toBe('covered');
    expect(byKey.get('natural-carbon-capture')?.status).toBe('covered');
    expect(byKey.get('child-study-center')?.status).toBe('covered');
    expect(byKey.get('child-study-center')?.school).toBe('Yale School of Medicine');

    const byUrl = new Map(CENTERS_INSTITUTES_REGISTRY.map((e) => [e.url, e]));
    expect(byUrl.get('https://medicine.yale.edu/childstudy/faculty/')?.status).toBe('covered');
    expect(
      byUrl.get('https://medicine.yale.edu/center-clinical-investigation/about/leadership/')
        ?.status,
    ).toBe('evaluated-skipped');
    expect(byUrl.get('https://naturalcarboncapture.yale.edu/people')?.status).toBe('covered');
    expect(byUrl.get('https://cie.research.yale.edu/people')?.status).toBe('partial');
    expect(byUrl.get('https://yibs.yale.edu/people/faculty-affiliates')?.status).toBe('partial');
    expect(byUrl.get('https://westcampus.yale.edu/about-us/faculty')?.status).toBe(
      'evaluated-skipped',
    );
    expect(byUrl.get('https://ipch.yale.edu/people')?.status).toBe('evaluated-skipped');
    expect(byUrl.get('https://poorvucenter.yale.edu/')?.status).toBe('evaluated-skipped');
    expect(byUrl.get('https://fds.yale.edu/people/')?.status).toBe('covered');
  });

  it('gives every gap row an explicit next-step blocker in its notes', () => {
    for (const entry of getCentersInstitutesByStatus('gap')) {
      expect(entry.notes, entry.url).toBeTruthy();
      expect(entry.notes!.length, entry.url).toBeGreaterThan(0);
    }
  });

  it('ranks live gaps (gap + partial) by impact tier then member count and excludes skipped rows', () => {
    const gaps = getCenterCoverageGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const entry of gaps) {
      expect(entry.status === 'gap' || entry.status === 'partial', entry.url).toBe(true);
    }
    for (const entry of getCentersInstitutesByStatus('evaluated-skipped')) {
      expect(gaps).not.toContain(entry);
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
