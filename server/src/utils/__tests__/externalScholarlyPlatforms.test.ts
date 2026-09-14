import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_SCHOLARLY_PLATFORM_HOSTS,
  isExternalScholarlyPlatformHost,
  isExternalScholarlyPlatformName,
} from '../externalScholarlyPlatforms';

describe('isExternalScholarlyPlatformName', () => {
  it('refuses a platform brand standing alone as a name', () => {
    for (const name of [
      'Google Scholar',
      'google scholar',
      'GOOGLE SCHOLAR',
      'Google  Scholar',
      'ResearchGate',
      'Research Gate',
      'ORCID',
      'LinkedIn',
      'PubMed',
      'Semantic Scholar',
      'Academia.edu',
      'NIH RePORTER',
    ]) {
      expect(isExternalScholarlyPlatformName(name), name).toBe(true);
    }
  });

  it('drops a leading article, because a CMS label often carries one', () => {
    expect(isExternalScholarlyPlatformName('The Google Scholar')).toBe(true);
    expect(isExternalScholarlyPlatformName('My ORCID')).toBe(true);
  });

  // The calibration result: a name that merely contains a brand is usually a real
  // research home saying where its output lives. "Onofrey Lab GitHub" is the live
  // example that made exact matching load-bearing rather than a nicety.
  it('accepts a real name that merely contains a platform brand', () => {
    for (const name of [
      'Onofrey Lab GitHub',
      'Google Scholar Metrics Lab',
      'ORCID Adoption Initiative',
      'Yale LinkedIn Research Group',
      'Scholar Development Program',
    ]) {
      expect(isExternalScholarlyPlatformName(name), name).toBe(false);
    }
  });

  it('accepts ordinary research home names', () => {
    for (const name of [
      'De Camilli Lab',
      'Yale Cancer Center',
      'Gur Yaari Faculty Research',
      'Center for Breast Cancer',
    ]) {
      expect(isExternalScholarlyPlatformName(name), name).toBe(false);
    }
  });

  it('leaves an empty or non-string value to the rules that own it', () => {
    expect(isExternalScholarlyPlatformName('')).toBe(false);
    expect(isExternalScholarlyPlatformName('   ')).toBe(false);
    expect(isExternalScholarlyPlatformName('The')).toBe(false);
    expect(isExternalScholarlyPlatformName(undefined)).toBe(false);
    expect(isExternalScholarlyPlatformName(42)).toBe(false);
  });
});

describe('isExternalScholarlyPlatformHost', () => {
  it('matches every declared host, case-insensitively', () => {
    for (const host of EXTERNAL_SCHOLARLY_PLATFORM_HOSTS) {
      expect(isExternalScholarlyPlatformHost(host), host).toBe(true);
      expect(isExternalScholarlyPlatformHost(host.toUpperCase()), host).toBe(true);
    }
  });

  // The regex this replaced was suffix-anchored, so it caught subdomains. Losing
  // that silently would have re-admitted api.nsf.gov as a research home website.
  it('matches a subdomain of a platform host', () => {
    expect(isExternalScholarlyPlatformHost('api.nsf.gov')).toBe(true);
    expect(isExternalScholarlyPlatformHost('www.linkedin.com')).toBe(true);
    expect(isExternalScholarlyPlatformHost('www.researchgate.net')).toBe(true);
  });

  it('does not match a Yale host or a lookalike suffix', () => {
    expect(isExternalScholarlyPlatformHost('medicine.yale.edu')).toBe(false);
    expect(isExternalScholarlyPlatformHost('notorcid.org')).toBe(false);
    expect(isExternalScholarlyPlatformHost('fakensf.gov')).toBe(false);
    expect(isExternalScholarlyPlatformHost('')).toBe(false);
    expect(isExternalScholarlyPlatformHost(undefined)).toBe(false);
  });
});
