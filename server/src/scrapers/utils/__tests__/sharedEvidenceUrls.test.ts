import { describe, expect, it } from 'vitest';
import {
  evidenceUrlsOf,
  isSharedEvidenceUrl,
  normalizeEvidenceUrl,
  sharedEvidenceUrls,
  institutionalEvidenceHosts,
  isInstitutionSectionLandingUrl,
} from '../sharedEvidenceUrls';

describe('normalizeEvidenceUrl', () => {
  it('treats one landing page cited four ways as one page', () => {
    const forms = [
      'https://example.edu/research',
      'https://example.edu/research/',
      'https://www.example.edu/Research/?utm_source=x',
      'https://example.edu/research#overview',
    ];
    expect(new Set(forms.map(normalizeEvidenceUrl)).size).toBe(1);
  });

  it('keeps two different pages on one host distinct', () => {
    expect(normalizeEvidenceUrl('https://example.edu/research')).not.toBe(
      normalizeEvidenceUrl('https://example.edu/labs/ion-channels'),
    );
  });

  it('returns empty for a value that is not a URL', () => {
    expect(normalizeEvidenceUrl('not a url')).toBe('');
    expect(normalizeEvidenceUrl(undefined)).toBe('');
  });
});

describe('evidenceUrlsOf', () => {
  it('collects the website and cited URLs without double counting one page', () => {
    expect(
      evidenceUrlsOf({
        websiteUrl: 'https://example.edu/research/',
        sourceUrls: ['https://example.edu/research', 'https://example.edu/labs/a'],
      }),
    ).toEqual(['https://example.edu/research', 'https://example.edu/labs/a']);
  });
});

describe('sharedEvidenceUrls', () => {
  it('flags a landing page cited by three rows', () => {
    const shared = sharedEvidenceUrls([
      { sourceUrls: ['https://example.edu/research'] },
      { sourceUrls: ['https://example.edu/research/'] },
      { websiteUrl: 'https://example.edu/research' },
    ]);
    expect(isSharedEvidenceUrl('https://example.edu/research', shared)).toBe(true);
  });

  // Deliberately replaced: an earlier version counted only rows whose citation was
  // their SOLE one, and this case asserted such a page stayed unflagged. Measured with
  // `--explain` over the description-empty cohort, that left two rows still receiving
  // one school landing page's blurb, because the lane picks the umbrella URL whether
  // or not the row cites anything else.
  it('flags a shared page even when a citing row also cites its own site', () => {
    const shared = sharedEvidenceUrls([
      { sourceUrls: ['https://example.edu/centre'] },
      { sourceUrls: ['https://example.edu/centre', 'https://ownlab.example.org/'] },
    ]);
    expect(isSharedEvidenceUrl('https://example.edu/centre', shared)).toBe(true);
    expect(isSharedEvidenceUrl('https://ownlab.example.org/', shared)).toBe(false);
  });

  it('leaves a page cited by exactly one row alone, which is the branded-centre case', () => {
    const shared = sharedEvidenceUrls([
      { sourceUrls: ['https://example.edu/cancer-centre'] },
      { sourceUrls: ['https://example.edu/other'] },
    ]);
    expect(isSharedEvidenceUrl('https://example.edu/cancer-centre', shared)).toBe(false);
  });

  it('does not let one row citing the same page twice look shared', () => {
    const shared = sharedEvidenceUrls([
      { websiteUrl: 'https://example.edu/research', sourceUrls: ['https://example.edu/research/'] },
    ]);
    expect(shared.size).toBe(0);
  });

  it('flags a landing page cited by three rows that each cite other pages too', () => {
    const shared = sharedEvidenceUrls([
      { sourceUrls: ['https://example.edu/research', 'https://example.edu/a'] },
      { sourceUrls: ['https://example.edu/research/', 'https://example.edu/b'] },
      { websiteUrl: 'https://example.edu/research', sourceUrls: ['https://example.edu/c'] },
    ]);
    expect(isSharedEvidenceUrl('https://example.edu/research', shared)).toBe(true);
    expect(isSharedEvidenceUrl('https://example.edu/a', shared)).toBe(false);
  });

  it('ignores rows that cite nothing', () => {
    expect(sharedEvidenceUrls([{}, { sourceUrls: [] }]).size).toBe(0);
  });
});

describe('institutionalEvidenceHosts', () => {
  const corpus = [
    ...Array.from({ length: 30 }, (_, index) => ({
      sourceUrls: [`https://medicine.example.edu/profile/person-${index}`],
    })),
    { sourceUrls: ['https://proberlab.example.edu/'] },
    { sourceUrls: ['https://tu-lab.example.org/research'] },
  ];

  it('names the host that serves many rows and not the single-lab hosts', () => {
    const hosts = institutionalEvidenceHosts(corpus);
    expect(hosts.has('medicine.example.edu')).toBe(true);
    expect(hosts.has('proberlab.example.edu')).toBe(false);
    expect(hosts.has('tu-lab.example.org')).toBe(false);
  });

  it('counts a host once per row however many of its pages that row cites', () => {
    const hosts = institutionalEvidenceHosts(
      [{ sourceUrls: ['https://one.example.edu/a', 'https://one.example.edu/b'] }],
      2,
    );
    expect(hosts.has('one.example.edu')).toBe(false);
  });
});

describe('isInstitutionSectionLandingUrl', () => {
  const hosts = new Set(['medicine.example.edu']);

  it('refuses a school-wide research landing page', () => {
    expect(isInstitutionSectionLandingUrl('https://medicine.example.edu/research/', hosts)).toBe(
      true,
    );
  });

  it('keeps a named centre several segments deep on the same host', () => {
    expect(
      isInstitutionSectionLandingUrl(
        'https://medicine.example.edu/internal-medicine/genmed/eric/',
        hosts,
      ),
    ).toBe(false);
  });

  it("keeps a lab's own research page, because its host is not institutional", () => {
    expect(isInstitutionSectionLandingUrl('https://tu-lab.example.org/research', hosts)).toBe(
      false,
    );
  });

  it('keeps a person page on an institutional host', () => {
    expect(
      isInstitutionSectionLandingUrl('https://medicine.example.edu/profile/someone/', hosts),
    ).toBe(false);
  });
});
