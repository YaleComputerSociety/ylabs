import { describe, expect, it } from 'vitest';
import { collectSourceLinkHealthCandidates } from '../backfillSourceLinkHealthCore';

describe('collectSourceLinkHealthCandidates', () => {
  it('gathers entity website, website, source URLs, and extra signal URLs', () => {
    const candidates = collectSourceLinkHealthCandidates(
      {
        websiteUrl: 'https://lab.example.yale.edu/',
        website: 'https://old.example.yale.edu/lab',
        sourceUrls: ['https://example.yale.edu/join'],
      },
      ['https://example.yale.edu/apply'],
    );

    expect(candidates).toEqual([
      'https://lab.example.yale.edu/',
      'https://old.example.yale.edu/lab',
      'https://example.yale.edu/join',
      'https://example.yale.edu/apply',
    ]);
  });

  it('drops non-HTTP values and blanks', () => {
    const candidates = collectSourceLinkHealthCandidates({
      websiteUrl: 'javascript:alert(1)',
      website: '',
      sourceUrls: ['data:text/html,x', 'https://safe.example.edu/source', '   '],
    });

    expect(candidates).toEqual(['https://safe.example.edu/source']);
  });

  it('collapses scheme, www, and trailing-slash duplicates onto one probe', () => {
    const candidates = collectSourceLinkHealthCandidates(
      {
        websiteUrl: 'https://lab.example.yale.edu/research',
        sourceUrls: ['http://www.lab.example.yale.edu/research/'],
      },
      ['https://www.lab.example.yale.edu/research'],
    );

    expect(candidates).toEqual(['https://lab.example.yale.edu/research']);
  });

  it('keeps distinct query identifiers apart', () => {
    const candidates = collectSourceLinkHealthCandidates({
      sourceUrls: [
        'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1',
        'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2',
      ],
    });

    expect(candidates).toHaveLength(2);
  });
});
