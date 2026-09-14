import { describe, expect, it } from 'vitest';
import {
  YALE_PERSON_PAGE_PREFIXES,
  canonicalPersonPageUrlCandidate,
  isCurrentPersonPageUrl,
  isLegacyPersonPageUrl,
  personPagePrefixesForHost,
} from '../yalePersonPagePrefix';

describe('the four measured host migrations', () => {
  const migrations: Array<[string, string]> = [
    ['https://physics.yale.edu/people/nir-navon', 'https://physics.yale.edu/profile/nir-navon'],
    [
      'https://sociology.yale.edu/people/rourke-obrien',
      'https://sociology.yale.edu/profile/rourke-obrien',
    ],
    [
      'https://classics.yale.edu/people/andrew-johnston',
      'https://classics.yale.edu/profile/andrew-johnston',
    ],
    ['https://jackson.yale.edu/person/casey-king', 'https://jackson.yale.edu/directory/casey-king'],
  ];

  it('re-points a legacy prefix to the host current one', () => {
    for (const [legacy, expected] of migrations) {
      expect(isLegacyPersonPageUrl(legacy)).toBe(true);
      expect(canonicalPersonPageUrlCandidate(legacy)).toBe(expected);
    }
  });

  it('leaves a url already on the current prefix alone', () => {
    for (const [, current] of migrations) {
      expect(isLegacyPersonPageUrl(current)).toBe(false);
      expect(canonicalPersonPageUrlCandidate(current)).toBeUndefined();
      expect(isCurrentPersonPageUrl(current)).toBe(true);
    }
  });

  it('preserves a trailing-slash leaf and strips query and fragment', () => {
    expect(canonicalPersonPageUrlCandidate('https://physics.yale.edu/people/yu-he/?x=1#bio')).toBe(
      'https://physics.yale.edu/profile/yu-he',
    );
  });
});

describe('hosts that must not be rewritten', () => {
  // Answers 200 for person pages that do not exist, so a mapped rewrite would
  // manufacture a confidently wrong link.
  it('leaves quantuminstitute.yale.edu unmapped', () => {
    expect(personPagePrefixesForHost('quantuminstitute.yale.edu')).toBeUndefined();
    expect(
      canonicalPersonPageUrlCandidate('https://quantuminstitute.yale.edu/people/luigi-frunzio'),
    ).toBeUndefined();
  });

  it('never rewrites a host with no recorded migration', () => {
    for (const url of [
      'https://psychology.yale.edu/people/brian-scholl',
      'https://history.yale.edu/people/arne-westad',
      'https://nursing.yale.edu/faculty-research/faculty-directory/allison-cable',
      'https://ysph.yale.edu/profile/someone-else',
    ]) {
      expect(canonicalPersonPageUrlCandidate(url)).toBeUndefined();
    }
  });

  // Only a prefix the host is KNOWN to have migrated away from may be rewritten.
  // Without that allowlist, any unrecognised prefix on a mapped host would be
  // transposed into the person namespace: `medicine.yale.edu/lab/cohn/` would
  // become `/profile/cohn`, inventing a person page from a lab slug.
  it('never rewrites an unrecognised prefix that is not a recorded migration', () => {
    for (const url of [
      'https://medicine.yale.edu/lab/cohn/',
      'https://medicine.yale.edu/lab/solomon/',
      'https://psychology.yale.edu/profile/someone',
      'https://history.yale.edu/directory/someone',
      'https://ysph.yale.edu/school-of-public-health-faculty/haiqun-lin',
    ]) {
      expect(isLegacyPersonPageUrl(url)).toBe(false);
      expect(canonicalPersonPageUrlCandidate(url)).toBeUndefined();
    }
  });

  it('never rewrites an unmapped host', () => {
    expect(canonicalPersonPageUrlCandidate('https://example.com/people/someone')).toBeUndefined();
    expect(canonicalPersonPageUrlCandidate('https://tdps.yale.edu/people/someone')).toBeUndefined();
  });

  it('refuses a non-url and a bare host', () => {
    expect(canonicalPersonPageUrlCandidate(undefined)).toBeUndefined();
    expect(canonicalPersonPageUrlCandidate('not a url')).toBeUndefined();
    expect(canonicalPersonPageUrlCandidate('https://physics.yale.edu/')).toBeUndefined();
    expect(canonicalPersonPageUrlCandidate('https://physics.yale.edu/people')).toBeUndefined();
  });
});

describe('root-mapped and multi-namespace hosts', () => {
  it('treats a single-segment path as current for a root-mapped host', () => {
    expect(isCurrentPersonPageUrl('https://law.yale.edu/akhil-reed-amar')).toBe(true);
    expect(isCurrentPersonPageUrl('https://faculty.som.yale.edu/nicholasbarberis')).toBe(true);
  });

  // medicine.yale.edu runs three live person namespaces; a repair that recognised
  // only the canonical one would treat the other two as legacy and rewrite them.
  it('accepts all three medicine.yale.edu person namespaces as current', () => {
    for (const url of [
      'https://medicine.yale.edu/profile/roy-herbst/',
      'https://medicine.yale.edu/cancer/profile/roy-herbst/',
      'https://medicine.yale.edu/bbs/profile/shuangge-ma/',
    ]) {
      expect(isCurrentPersonPageUrl(url)).toBe(true);
      expect(canonicalPersonPageUrlCandidate(url)).toBeUndefined();
    }
  });
});

describe('map shape', () => {
  it('gives every host at least one current prefix, canonical first', () => {
    for (const [host, entry] of Object.entries(YALE_PERSON_PAGE_PREFIXES)) {
      expect(entry.current.length, host).toBeGreaterThan(0);
      expect(host).toBe(host.toLowerCase());
    }
  });

  it('never lists a prefix as both current and legacy', () => {
    for (const [host, entry] of Object.entries(YALE_PERSON_PAGE_PREFIXES)) {
      for (const legacy of entry.legacy || []) {
        expect(entry.current, host).not.toContain(legacy);
      }
    }
  });

  it('records a legacy prefix only for the four measured migrations', () => {
    const withLegacy = Object.entries(YALE_PERSON_PAGE_PREFIXES)
      .filter(([, entry]) => (entry.legacy || []).length > 0)
      .map(([host]) => host)
      .sort();
    expect(withLegacy).toEqual([
      'classics.yale.edu',
      'jackson.yale.edu',
      'physics.yale.edu',
      'sociology.yale.edu',
    ]);
  });
});
