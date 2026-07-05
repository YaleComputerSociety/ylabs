import { afterEach, describe, expect, it } from 'vitest';
import { applySeoMetadata, buildResearchSeoMetadata } from '../seo';

describe('research SEO client fallback', () => {
  afterEach(() => {
    document.title = '';
    document.head.innerHTML = '';
  });

  it('builds useful listing metadata without exposing private contact fields', () => {
    const metadata = buildResearchSeoMetadata({
      origin: 'https://yalelabs.io',
      pathname: '/research/evidence-backed-lab',
      researchEntity: {
        name: 'Evidence-backed lab',
        description: 'Study immune signaling in public datasets.',
        researchAreas: ['Computational Biology'],
        ownerEmail: 'private@yale.edu',
        emails: ['private-list@yale.edu'],
      } as any,
    });

    expect(metadata.title).toBe('Evidence-backed lab | Yale Research');
    expect(metadata.description).toBe('Study immune signaling in public datasets.');
    expect(JSON.stringify(metadata)).not.toContain('private@yale.edu');
    expect(JSON.stringify(metadata)).not.toContain('private-list@yale.edu');
  });

  it('updates canonical and social tags after React loads when server injection is unavailable', () => {
    const metadata = buildResearchSeoMetadata({
      origin: 'https://yalelabs.io',
      pathname: '/research',
    });

    applySeoMetadata(metadata);

    expect(document.title).toBe('Yale Research');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://yalelabs.io/research',
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Find research pathways, labs, programs, and evidence-backed next steps at Yale University.',
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'Yale Research',
    );
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary',
    );
  });
});
