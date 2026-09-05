import { describe, it, expect, vi } from 'vitest';
import {
  declaredLeadCandidateUrls,
  extractLabSiteDeclaredLead,
  isNonLabSiteUrl,
} from '../labSiteDeclaredLeadExtractor';

const APOLLO_ROOT_HTML = `
  <nav>
    <a href="/">Home</a>
    <a href="/research/">Research</a>
    <a href="/team/">Team</a>
    <a href="/publications/">Publications</a>
    <a href="/news/">News</a>
    <a href="/joining/">Joining</a>
  </nav>
  <h1>Applied Planning, Learning, and Optimization (APOLLO) Lab</h1>
  <p>Two papers accepted to CoRL 2026 (authors: Xiatao Sun, ..., Daniel Rakita)</p>
`;

describe('declaredLeadCandidateUrls', () => {
  it('reads the site root first, then its roster page', () => {
    const urls = declaredLeadCandidateUrls('https://apollo-lab-yale.github.io/', APOLLO_ROOT_HTML);
    expect(urls[0]).toBe('https://apollo-lab-yale.github.io/');
    expect(urls).toContain('https://apollo-lab-yale.github.io/team/');
  });

  it('ranks a roster page above an about page', () => {
    const urls = declaredLeadCandidateUrls(
      'https://example-lab.org/',
      '<a href="/about/">About</a><a href="/people/">People</a>',
    );
    expect(urls.indexOf('https://example-lab.org/people/')).toBeLessThan(
      urls.indexOf('https://example-lab.org/about/'),
    );
  });

  it('never leaves the site, so a link out is not read as its roster', () => {
    const urls = declaredLeadCandidateUrls(
      'https://example-lab.org/',
      '<a href="https://medicine.yale.edu/lab/other/team/">Team</a><a href="/team/">Team</a>',
    );
    expect(urls).toEqual(['https://example-lab.org/', 'https://example-lab.org/team/']);
  });

  it('drops non-http schemes and fragments', () => {
    const urls = declaredLeadCandidateUrls(
      'https://example-lab.org/',
      '<a href="mailto:lab@example.org">Team</a><a href="/team/#faculty">Team</a>',
    );
    expect(urls).toEqual(['https://example-lab.org/', 'https://example-lab.org/team/']);
  });

  it("stays inside the linked site's own subtree, so a CMS nav cannot reach the school's About page", () => {
    const urls = declaredLeadCandidateUrls(
      'https://medicine.yale.edu/labmed',
      '<a href="/about/">About</a><a href="/labmed/people/">People</a><a href="/pediatrics/">Pediatrics</a>',
    );
    expect(urls).toEqual([
      'https://medicine.yale.edu/labmed',
      'https://medicine.yale.edu/labmed/people/',
    ]);
  });

  it('treats a subtree root with a trailing slash the same way', () => {
    const urls = declaredLeadCandidateUrls(
      'https://medicine.yale.edu/lab/melnick/',
      '<a href="/about/">About</a><a href="/lab/melnick/team/">Team</a>',
    );
    expect(urls).toEqual([
      'https://medicine.yale.edu/lab/melnick/',
      'https://medicine.yale.edu/lab/melnick/team/',
    ]);
  });

  it('caps how many pages one site can cost', () => {
    const html = ['team', 'people', 'members', 'about', 'faculty', 'group', 'lab']
      .map((slug) => `<a href="/${slug}/">${slug}</a>`)
      .join('');
    expect(declaredLeadCandidateUrls('https://example-lab.org/', html)).toHaveLength(4);
  });
});

describe('isNonLabSiteUrl', () => {
  it('rejects the aggregators and shorteners a profile lab-website slot holds', () => {
    for (const url of [
      'https://scholar.google.com/citations?user=IRRcgAEAAAAJ',
      'https://pubmed.ncbi.nlm.nih.gov/16849964/',
      'https://t.co/PnadqKME4H',
      'https://www.linkedin.com/in/someone',
      'https://doi.org/10.1210/en.136.4.1775',
    ]) {
      expect(isNonLabSiteUrl(url)).toBe(true);
    }
  });

  it('accepts a lab site on its own domain or a Yale host', () => {
    for (const url of [
      'https://apollo-lab-yale.github.io',
      'https://medicine.yale.edu/lab/decamilli/',
      'https://www.sassylab.org',
    ]) {
      expect(isNonLabSiteUrl(url)).toBe(false);
    }
  });

  it('rejects a value that is not a URL at all', () => {
    expect(isNonLabSiteUrl('')).toBe(true);
    expect(isNonLabSiteUrl('lab website')).toBe(true);
    expect(isNonLabSiteUrl(undefined)).toBe(true);
  });
});

describe('extractLabSiteDeclaredLead', () => {
  const fetchApollo = async (url: string) =>
    url.includes('/team/')
      ? { url, html: '<h2>Faculty</h2><p>Daniel Rakita, Principal Investigator</p>' }
      : { url, html: APOLLO_ROOT_HTML };

  it('reads the lead off the roster page when the homepage only credits news items', async () => {
    const callLLM = vi.fn(async (input: { sourceUrl: string }) =>
      input.sourceUrl.includes('/team/')
        ? { declaredLead: 'Daniel Rakita', labName: '' }
        : {
            declaredLead: '',
            labName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
          },
    );
    const result = await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: 'test-key',
      fetchPage: fetchApollo,
      callLLM,
    });
    expect(result).toMatchObject({
      declaredLead: 'Daniel Rakita',
      labName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
      evidenceUrl: 'https://apollo-lab-yale.github.io/team/',
    });
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('stops at the first page that states a lead', async () => {
    const callLLM = vi.fn(async () => ({ declaredLead: 'Daniel Rakita', labName: 'APOLLO Lab' }));
    await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: 'test-key',
      fetchPage: fetchApollo,
      callLLM,
    });
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('returns null when no page states a lead, rather than a best guess', async () => {
    const result = await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: 'test-key',
      fetchPage: fetchApollo,
      callLLM: async () => ({ declaredLead: '', labName: 'APOLLO Lab' }),
    });
    expect(result).toBeNull();
  });

  it('returns null when the site cannot be fetched', async () => {
    const result = await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: 'test-key',
      fetchPage: async () => null,
      callLLM: async () => ({ declaredLead: 'Daniel Rakita', labName: '' }),
    });
    expect(result).toBeNull();
  });

  it('returns null with no API key instead of reading the site for nothing', async () => {
    const fetchPage = vi.fn(fetchApollo);
    const result = await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: '',
      fetchPage,
      callLLM: async () => ({ declaredLead: 'Daniel Rakita', labName: '' }),
    });
    expect(result).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('advances past a page whose extraction throws', async () => {
    const callLLM = vi.fn(async (input: { sourceUrl: string }) => {
      if (!input.sourceUrl.includes('/team/')) throw new Error('LLM returned empty content');
      return { declaredLead: 'Daniel Rakita', labName: 'APOLLO Lab' };
    });
    const result = await extractLabSiteDeclaredLead('https://apollo-lab-yale.github.io', {
      apiKey: 'test-key',
      fetchPage: fetchApollo,
      callLLM,
    });
    expect(result?.declaredLead).toBe('Daniel Rakita');
  });
});
