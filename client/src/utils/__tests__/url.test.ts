import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openSafeUrlInNewTab,
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
    expect(safeUrl('http://')).toBe('');
    expect(safeUrl(null)).toBe('');
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
  });
});

describe('openSafeUrlInNewTab', () => {
  it('opens safe URLs with noopener/noreferrer and clears the opener reference', () => {
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

  it('does not open unsafe URLs', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openSafeUrlInNewTab('javascript:alert(1)')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
