import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  candidateProfileUrls,
  defaultVerifier,
} from '../backfillResearchHomeOfficialUrls';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('backfillResearchHomeOfficialUrls URL safety', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('keeps only parsed Yale hosts from stored profile URLs', () => {
    const urls = candidateProfileUrls({
      fname: 'Ada',
      lname: 'Lovelace',
      profileUrls: {
        good: 'https://medicine.yale.edu/profile/ada-lovelace/',
        pathOnlyMatch: 'http://127.0.0.1/yale.edu/internal',
        lookalike: 'https://medicine.yale.edu.evil.example/profile/ada-lovelace/',
        credentialed: 'https://user:pass@medicine.yale.edu/profile/ada-lovelace/',
      },
    });

    expect(urls).toContain('https://medicine.yale.edu/profile/ada-lovelace/');
    expect(urls).toContain('https://medicine.yale.edu/profile/adalovelace/');
    expect(urls).not.toContain('http://127.0.0.1/yale.edu/internal');
    expect(urls).not.toContain('https://medicine.yale.edu.evil.example/profile/ada-lovelace/');
    expect(urls).not.toContain('https://user:pass@medicine.yale.edu/profile/ada-lovelace/');
  });

  it('rejects non-Yale and private verification URLs before fetching', async () => {
    await expect(defaultVerifier('http://127.0.0.1/yale.edu/internal', 'Lovelace')).resolves.toBe(
      false,
    );
    await expect(
      defaultVerifier('https://medicine.yale.edu.evil.example/profile/ada-lovelace/', 'Lovelace'),
    ).resolves.toBe(false);

    expect(axios.get).not.toHaveBeenCalled();
  });
});
