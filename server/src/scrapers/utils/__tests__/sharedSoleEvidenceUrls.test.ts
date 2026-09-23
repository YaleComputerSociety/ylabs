import { describe, expect, it } from 'vitest';
import {
  evidenceUrlsOf,
  isSharedSoleEvidenceUrl,
  normalizeEvidenceUrl,
  sharedSoleEvidenceUrls,
} from '../sharedSoleEvidenceUrls';

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

describe('sharedSoleEvidenceUrls', () => {
  it('flags a landing page that is the only citation of three rows', () => {
    const shared = sharedSoleEvidenceUrls([
      { sourceUrls: ['https://example.edu/research'] },
      { sourceUrls: ['https://example.edu/research/'] },
      { websiteUrl: 'https://example.edu/research' },
    ]);
    expect(isSharedSoleEvidenceUrl('https://example.edu/research', shared)).toBe(true);
  });

  it('leaves a shared page alone when only one row has nothing else', () => {
    const shared = sharedSoleEvidenceUrls([
      { sourceUrls: ['https://example.edu/centre'] },
      { sourceUrls: ['https://example.edu/centre', 'https://ownlab.example.org/'] },
    ]);
    expect(isSharedSoleEvidenceUrl('https://example.edu/centre', shared)).toBe(false);
  });

  it('leaves a page cited by exactly one row alone, which is the branded-centre case', () => {
    const shared = sharedSoleEvidenceUrls([
      { sourceUrls: ['https://example.edu/cancer-centre'] },
      { sourceUrls: ['https://example.edu/other'] },
    ]);
    expect(isSharedSoleEvidenceUrl('https://example.edu/cancer-centre', shared)).toBe(false);
  });

  it('does not let one row citing the same page twice look shared', () => {
    const shared = sharedSoleEvidenceUrls([
      { websiteUrl: 'https://example.edu/research', sourceUrls: ['https://example.edu/research/'] },
    ]);
    expect(shared.size).toBe(0);
  });

  it('ignores rows that cite nothing', () => {
    expect(sharedSoleEvidenceUrls([{}, { sourceUrls: [] }]).size).toBe(0);
  });
});
