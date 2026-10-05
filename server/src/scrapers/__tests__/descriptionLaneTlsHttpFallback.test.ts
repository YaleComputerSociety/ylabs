import { describe, expect, it, vi } from 'vitest';
import { fetchDescriptionPageWithTlsFallback } from '../sources/labMicrositeDescriptionLLMExtractor';

const tlsError = (code: string) => Object.assign(new Error(code), { code });

describe('fetchDescriptionPageWithTlsFallback (#4639)', () => {
  it('re-reads an https page over http when its certificate fails verification', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url.startsWith('https:')) throw tlsError('CERT_HAS_EXPIRED');
      return { url, html: '<p>Research statement</p>' };
    });

    const page = await fetchDescriptionPageWithTlsFallback(
      'https://stats.example.edu/~fixture/',
      fetchPage,
    );

    expect(page).toEqual({
      url: 'http://stats.example.edu/~fixture/',
      html: '<p>Research statement</p>',
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('does not downgrade on an error that is not a certificate failure', async () => {
    const fetchPage = vi.fn(async () => {
      throw tlsError('ECONNREFUSED');
    });

    await expect(
      fetchDescriptionPageWithTlsFallback('https://stats.example.edu/~fixture/', fetchPage),
    ).rejects.toThrow('ECONNREFUSED');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not retry an http page', async () => {
    const fetchPage = vi.fn(async () => {
      throw tlsError('CERT_HAS_EXPIRED');
    });

    await expect(
      fetchDescriptionPageWithTlsFallback('http://stats.example.edu/~fixture/', fetchPage),
    ).rejects.toThrow('CERT_HAS_EXPIRED');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
