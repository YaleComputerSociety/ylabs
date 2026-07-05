import { describe, expect, it } from 'vitest';
import {
  buildPublicResearchSeoMetadata,
  injectSeoMetadata,
  renderSeoTags,
} from '../publicResearchSeo';

describe('public research SEO metadata', () => {
  it('builds share metadata from public-safe listing fields only', () => {
    const metadata = buildPublicResearchSeoMetadata({
      baseUrl: 'https://yalelabs.io/',
      path: '/research/evidence-backed-lab-507f1f77bcf86cd799439011',
      listing: {
        title: 'Evidence-backed lab',
        description: 'Study immune signaling in public datasets.',
        ownerFirstName: 'Ada',
        ownerLastName: 'Lovelace',
        ownerPrimaryDepartment: 'Computer Science',
        departments: ['Computer Science'],
        researchAreas: ['Computational Biology'],
        ownerEmail: 'private@yale.edu',
        emails: ['private-list@yale.edu'],
      } as any,
    });
    const tags = renderSeoTags(metadata);

    expect(metadata.title).toBe('Evidence-backed lab | YaleLabs');
    expect(metadata.description).toBe('Study immune signaling in public datasets.');
    expect(metadata.canonicalUrl).toBe(
      'https://yalelabs.io/research/evidence-backed-lab-507f1f77bcf86cd799439011',
    );
    expect(tags).toContain('property="og:title" content="Evidence-backed lab | YaleLabs"');
    expect(tags).not.toContain('private@yale.edu');
    expect(tags).not.toContain('private-list@yale.edu');
  });

  it('injects crawler-visible public research metadata into the SPA shell', () => {
    const html = `<!doctype html><html><head><title>YaleLabs</title><!--YL_SEO_META_START--><meta name="description" content="old" /><!--YL_SEO_META_END--></head><body></body></html>`;
    const metadata = buildPublicResearchSeoMetadata({
      baseUrl: 'https://yalelabs.io',
      path: '/research',
    });

    const injected = injectSeoMetadata(html, metadata);

    expect(injected).toContain('<title>YaleLabs Research</title>');
    expect(injected).toContain('rel="canonical" href="https://yalelabs.io/research"');
    expect(injected).toContain('property="og:type" content="website"');
    expect(injected).toContain('name="twitter:card" content="summary"');
    expect(injected).not.toContain('content="old"');
  });
});
