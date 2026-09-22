import { describe, expect, it } from 'vitest';

import {
  isEphemeralDeployHostUrl,
  isPublicHttpUrl,
  isSelfReferentialUrl,
  publicHttpUrl,
} from '../urlSafety';

describe('urlSafety', () => {
  it('rejects credentialed HTTP URLs as non-public', () => {
    expect(isPublicHttpUrl('https://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('http://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('https://user:pass@example.yale.edu/private')).toBe(false);
    expect(isPublicHttpUrl('mailto:program@yale.edu')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isPublicHttpUrl('https://example.yale.edu/apply\nhttps://evil.example')).toBe(false);
    expect(isPublicHttpUrl('https:\\\\evil.example\\phish')).toBe(false);
    expect(isPublicHttpUrl('https://example.yale.edu/apply here')).toBe(false);
  });

  it('rejects oversized URL values before parsing or normalization', () => {
    const oversized = `https://example.yale.edu/${'a'.repeat(2049)}`;

    expect(isPublicHttpUrl(oversized)).toBe(false);
    expect(publicHttpUrl(oversized)).toBeUndefined();
  });

  it('recognizes Yale Research self-referential URLs so they cannot become a source', () => {
    expect(isSelfReferentialUrl('https://yalelabs.io/api/research')).toBe(true);
    expect(isSelfReferentialUrl('https://www.yalelabs.io/research/some-lab')).toBe(true);
    expect(isSelfReferentialUrl('https://ylabs-gr4v.onrender.com/api/research')).toBe(true);
    expect(isSelfReferentialUrl('https://yalelabs.onrender.com/')).toBe(true);
    expect(isSelfReferentialUrl('https://medicine.yale.edu/lab/qin-yan/')).toBe(false);
    expect(isSelfReferentialUrl('not a url')).toBe(false);
    expect(isSelfReferentialUrl(undefined)).toBe(false);
  });

  it('recognizes a platform-assigned deploy host so it cannot become a citation', () => {
    expect(
      isEphemeralDeployHostUrl(
        'https://ysoa-2025-nuxt-production-fqvp7.ondigitalocean.app/people/faculty-and-staff',
      ),
    ).toBe(true);
    expect(isEphemeralDeployHostUrl('https://random-slug-ab12c.ondigitalocean.app/')).toBe(true);
    expect(isEphemeralDeployHostUrl('https://tidy-cats-run-fast.trycloudflare.com/')).toBe(true);
    expect(isEphemeralDeployHostUrl('https://1a2b3c4d.ngrok-free.app/lab')).toBe(true);
    expect(isEphemeralDeployHostUrl('https://ONDIGITALOCEAN.APP./x')).toBe(true);
  });

  it('keeps a platform host whose subdomain its owner chose, which may be the only address', () => {
    expect(isEphemeralDeployHostUrl('https://www.art.yale.edu/people/faculty-and-staff')).toBe(
      false,
    );
    expect(isEphemeralDeployHostUrl('https://some-lab.github.io/')).toBe(false);
    expect(isEphemeralDeployHostUrl('https://some-person.vercel.app/')).toBe(false);
    expect(isEphemeralDeployHostUrl('https://some-lab.netlify.app/')).toBe(false);
    expect(isEphemeralDeployHostUrl('https://some-lab.onrender.com/')).toBe(false);
    // A registrable domain that merely ENDS with the same letters is not on the platform.
    expect(isEphemeralDeployHostUrl('https://notondigitalocean.app/')).toBe(false);
    expect(isEphemeralDeployHostUrl('not a url')).toBe(false);
    expect(isEphemeralDeployHostUrl(undefined)).toBe(false);
  });
});
