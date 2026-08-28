import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openSafeUrlInNewTab,
  safeDoiUrl,
  safeHttpUrl,
  safeHttpUrlList,
  safeMailtoHref,
  safeUrl,
  safeUrlList,
} from '../url';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safeUrl', () => {
  it('allows http, https, and mailto URLs while normalizing scheme-less domains', () => {
    expect(safeUrl('example.yale.edu/apply')).toBe('https://example.yale.edu/apply');
    expect(safeUrl('https://example.yale.edu/apply')).toBe('https://example.yale.edu/apply');
    expect(safeUrl('mailto:advisor@yale.edu')).toBe('mailto:advisor@yale.edu');
  });

  it('rejects scriptable and malformed URL values', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('mailto:advisor@yale.edu?bcc=attacker@example.test')).toBe('');
    expect(safeUrl('https://user:pass@example.yale.edu/private')).toBe('');
    expect(safeUrl('https://example.yale.edu/apply\nhttps://evil.example')).toBe('');
    expect(safeUrl('https:\\\\evil.example\\phish')).toBe('');
    expect(safeUrl('https://example.yale.edu/apply here')).toBe('');
    expect(safeUrl('http://')).toBe('');
    expect(safeUrl(null)).toBe('');
  });

  it('rejects oversized URL-like values before parsing', () => {
    expect(safeUrl(`https://example.yale.edu/${'a'.repeat(2049)}`)).toBe('');
  });
});

describe('safeUrlList', () => {
  it('deduplicates normalized safe URLs and drops unsafe values', () => {
    expect(
      safeUrlList([
        'https://example.yale.edu/apply',
        'https://example.yale.edu/apply',
        'javascript:alert(1)',
        '',
      ]),
    ).toEqual(['https://example.yale.edu/apply']);
  });

  it('rejects non-arrays and caps URL normalization work', () => {
    expect(safeUrlList('https://example.yale.edu/source')).toEqual([]);
    expect(
      safeUrlList(Array.from({ length: 55 }, (_, index) => `https://example.yale.edu/${index}`)),
    ).toHaveLength(50);
  });
});

describe('safeHttpUrl', () => {
  it('allows only browser-openable HTTP(S) URLs', () => {
    expect(safeHttpUrl('example.yale.edu/apply')).toBe('https://example.yale.edu/apply');
    expect(safeHttpUrl('https://example.yale.edu/apply')).toBe('https://example.yale.edu/apply');
    expect(safeHttpUrl('mailto:advisor@yale.edu')).toBe('');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
  });
});

describe('safeHttpUrlList', () => {
  it('deduplicates normalized HTTP(S) URLs and drops mailto values', () => {
    expect(
      safeHttpUrlList([
        'https://example.yale.edu/source',
        'example.yale.edu/source',
        'mailto:advisor@yale.edu',
      ]),
    ).toEqual(['https://example.yale.edu/source']);
  });

  it('rejects non-arrays and caps HTTP URL normalization work', () => {
    expect(safeHttpUrlList({ url: 'https://example.yale.edu/source' })).toEqual([]);
    expect(
      safeHttpUrlList(Array.from({ length: 55 }, (_, index) => `https://example.yale.edu/${index}`)),
    ).toHaveLength(50);
  });
});

describe('safeMailtoHref', () => {
  it('normalizes plain email addresses and encodes optional subject/body params', () => {
    expect(
      safeMailtoHref('Advisor@Yale.edu', {
        subject: 'Research inquiry',
        body: 'Hello,\nI reviewed your profile.',
      }),
    ).toBe(
      'mailto:advisor@yale.edu?subject=Research+inquiry&body=Hello%2C%0AI+reviewed+your+profile.',
    );
  });

  it('rejects mailto values with injected headers, multiple recipients, or invalid addresses', () => {
    expect(safeMailtoHref('advisor@yale.edu?bcc=attacker@example.test')).toBe('');
    expect(safeMailtoHref('advisor@yale.edu%0D%0ABcc:attacker@example.test')).toBe('');
    expect(safeMailtoHref('advisor@yale.edu,attacker@example.test')).toBe('');
    expect(safeMailtoHref('not an email')).toBe('');
    expect(safeMailtoHref(`${'a'.repeat(255)}@yale.edu`)).toBe('');
  });

  it('drops oversized optional mailto subject and body values', () => {
    expect(
      safeMailtoHref('advisor@yale.edu', {
        subject: 'a'.repeat(201),
        body: 'b'.repeat(2001),
      }),
    ).toBe('mailto:advisor@yale.edu');
  });
});

describe('safeDoiUrl', () => {
  it('normalizes valid DOI values to doi.org URLs', () => {
    expect(safeDoiUrl('10.1145/3368089.3409745')).toBe(
      'https://doi.org/10.1145/3368089.3409745',
    );
    expect(safeDoiUrl('https://doi.org/10.1145/3368089.3409745')).toBe(
      'https://doi.org/10.1145/3368089.3409745',
    );
    expect(safeDoiUrl('doi:10.1145/3368089.3409745')).toBe(
      'https://doi.org/10.1145/3368089.3409745',
    );
  });

  it('rejects malformed DOI values before rendering outbound links', () => {
    expect(safeDoiUrl('javascript:alert(1)')).toBe('');
    expect(safeDoiUrl('10.1145/3368089.3409745?next=https://evil.example')).toBe('');
    expect(safeDoiUrl('10.1145/3368089.3409745%0Aevil')).toBe('');
    expect(safeDoiUrl('https://user:pass@doi.org/10.1145/3368089.3409745')).toBe('');
    expect(safeDoiUrl(`10.1145/${'a'.repeat(513)}`)).toBe('');
  });
});

describe('openSafeUrlInNewTab', () => {
  it('opens safe HTTP(S) URLs with noopener/noreferrer and clears the opener reference', () => {
    const popup = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    expect(openSafeUrlInNewTab('https://docs.example.test/sheet')).toBe(popup);
    expect(open).toHaveBeenCalledWith(
      'https://docs.example.test/sheet',
      '_blank',
      'noopener,noreferrer',
    );
    expect(popup.opener).toBeNull();
  });

  it('does not open unsafe or non-HTTP(S) URLs', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openSafeUrlInNewTab('javascript:alert(1)')).toBeNull();
    expect(openSafeUrlInNewTab('mailto:advisor@yale.edu')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
