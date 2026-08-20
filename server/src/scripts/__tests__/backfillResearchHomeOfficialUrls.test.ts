import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  candidateProfileUrls,
  classifyResearchHomeUrlBackfillLane,
  defaultVerifier,
  isDescriptionBlockedLead,
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

describe('research-home URL backfill lane selection', () => {
  it('claims description- or action-blocked leads in still-visible tiers', () => {
    expect(
      isDescriptionBlockedLead({
        studentVisibilityTier: 'operator_review',
        studentVisibilityReasons: ['missing_description'],
      }),
    ).toBe(true);
    expect(
      isDescriptionBlockedLead({
        studentVisibilityTier: 'limited_but_safe',
        studentVisibilityReasons: ['concrete_next_step', 'missing_action_evidence'],
      }),
    ).toBe(true);
  });

  it('does not claim suppressed tiers or unrelated reasons for the description lane', () => {
    expect(
      isDescriptionBlockedLead({
        studentVisibilityTier: 'suppressed',
        studentVisibilityReasons: ['missing_description'],
      }),
    ).toBe(false);
    expect(
      isDescriptionBlockedLead({
        studentVisibilityTier: 'operator_review',
        studentVisibilityReasons: ['source_backed_description'],
      }),
    ).toBe(false);
  });

  it('routes a suppressed grant-only shell into the grant-only lane', () => {
    expect(
      classifyResearchHomeUrlBackfillLane({
        studentVisibilityTier: 'suppressed',
        studentVisibilityReasons: ['non_owner_grant_shell', 'missing_action_evidence'],
        websiteUrl: '',
        sourceUrls: ['https://reporter.nih.gov/project-details/123'],
      }),
    ).toBe('grant-only-shell');
  });

  it('prefers the description lane when an entity qualifies for both', () => {
    expect(
      classifyResearchHomeUrlBackfillLane({
        studentVisibilityTier: 'operator_review',
        studentVisibilityReasons: ['missing_description'],
        websiteUrl: '',
        sourceUrls: ['https://reporter.nih.gov/project-details/123'],
      }),
    ).toBe('description-block');
  });

  it('leaves an entity with a promotable official URL for the zero-network lane', () => {
    expect(
      classifyResearchHomeUrlBackfillLane({
        studentVisibilityTier: 'suppressed',
        studentVisibilityReasons: ['non_owner_grant_shell'],
        websiteUrl: '',
        sourceUrls: ['https://reporter.nih.gov/project-details/1', 'https://lab.yale.edu/'],
      }),
    ).toBeUndefined();
  });
});
