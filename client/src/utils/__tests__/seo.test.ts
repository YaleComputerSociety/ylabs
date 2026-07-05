import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { applySeoMetadata, buildDefaultSeoMetadata, buildResearchSeoMetadata } from '../seo';

describe('research SEO client fallback', () => {
  afterEach(() => {
    document.title = '';
    document.head.innerHTML = '';
  });

  it('builds useful listing metadata without exposing private contact fields', () => {
    const metadata = buildResearchSeoMetadata({
      origin: 'https://yalelabs.io',
      pathname: '/research/evidence-backed-lab-507f1f77bcf86cd799439011',
      listing: {
        title: 'Evidence-backed lab',
        description: 'Study immune signaling in public datasets.',
        ownerFirstName: 'Ada',
        ownerLastName: 'Lovelace',
        ownerPrimaryDepartment: 'Computer Science',
        researchAreas: ['Computational Biology'],
        ownerEmail: 'private@yale.edu',
        emails: ['private-list@yale.edu'],
      } as any,
    });

    expect(metadata.title).toBe('Evidence-backed lab | YaleLabs');
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

    expect(document.title).toBe('YaleLabs Research');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://yalelabs.io/research',
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Discover confirmed Yale research labs and opportunities by topic, department, and faculty mentor.',
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'YaleLabs Research',
    );
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary',
    );
  });

  it('restores default YaleLabs metadata after research metadata has been applied', () => {
    applySeoMetadata(
      buildResearchSeoMetadata({
        origin: 'https://yalelabs.io',
        pathname: '/research/evidence-backed-lab-507f1f77bcf86cd799439011',
        listing: {
          title: 'Evidence-backed lab',
          description: 'Study immune signaling in public datasets.',
        } as any,
      }),
    );

    applySeoMetadata(
      buildDefaultSeoMetadata({
        origin: 'https://yalelabs.io',
        pathname: '/fellowships',
      }),
    );

    expect(document.title).toBe('YaleLabs');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://yalelabs.io/fellowships',
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Find research labs at Yale University',
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'YaleLabs',
    );
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(
      'YaleLabs',
    );
  });

  it('keeps the static SPA shell metadata generic for non-research routes', () => {
    const html = readFileSync('index.html', 'utf8');

    expect(html).toContain('<title>YaleLabs</title>');
    expect(html).toContain('<meta name="description" content="Find research labs at Yale University" />');
    expect(html).toContain('<meta property="og:title" content="YaleLabs" />');
    expect(html).toContain(
      '<meta property="og:description" content="Find research labs at Yale University" />',
    );
    expect(html).toContain('<meta name="twitter:title" content="YaleLabs" />');
    expect(html).toContain(
      '<meta name="twitter:description" content="Find research labs at Yale University" />',
    );
  });
});
