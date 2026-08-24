import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toPublicResearcherDto } from '../researcherDto';
import type { PublicResearchEntityDto } from '../researchEntityDto';

const home = (overrides: Partial<PublicResearchEntityDto> = {}): PublicResearchEntityDto =>
  ({ _id: new mongoose.Types.ObjectId().toHexString(), slug: 'lab', name: 'Lab', ...overrides } as PublicResearchEntityDto);

const officialLink = {
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url: 'https://medicine.yale.edu/profile/ada',
  verifiedAt: new Date('2025-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
};

describe('toPublicResearcherDto', () => {
  it('projects a researcher with homes and verified identity links', () => {
    const dto = toPublicResearcherDto({
      id: 'abc',
      displayName: 'Dr Ada Researcher',
      profile: { title: 'Professor of Cell Biology', primaryDepartment: 'Cell Biology' },
      profileLinks: [
        officialLink,
        {
          kind: 'GOOGLE_SCHOLAR',
          purpose: 'SCHOLARLY',
          url: 'https://scholar.google.com/citations?user=abc123',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      homes: [home({ school: 'School of Medicine' }), home({ school: 'School of Medicine' })],
    });

    expect(dto).not.toBeNull();
    expect(dto?.publicKey).toBe('abc');
    expect(dto?.title).toBe('Professor of Cell Biology');
    expect(dto?.school).toBe('School of Medicine');
    expect(dto?.officialProfileUrl).toBe('https://medicine.yale.edu/profile/ada');
    expect(dto?.scholarUrl).toBe('https://scholar.google.com/citations?user=abc123');
    expect(dto?.homes).toHaveLength(2);
  });

  it('renders a researcher with no homes when it has a verified primary-identity link', () => {
    const dto = toPublicResearcherDto({
      id: 'abc',
      displayName: 'Dr No Lab',
      profileLinks: [officialLink],
      homes: [],
    });
    expect(dto).not.toBeNull();
    expect(dto?.homes).toHaveLength(0);
    expect(dto?.officialProfileUrl).toBe('https://medicine.yale.edu/profile/ada');
  });

  it('fails closed when there are no homes and no primary-identity link', () => {
    expect(
      toPublicResearcherDto({ id: 'abc', displayName: 'Dr Ghost', profileLinks: [], homes: [] }),
    ).toBeNull();
  });

  it('does not treat a Scholar-only link as a public identity', () => {
    expect(
      toPublicResearcherDto({
        id: 'abc',
        displayName: 'Dr Scholar Only',
        profileLinks: [
          {
            kind: 'GOOGLE_SCHOLAR',
            purpose: 'SCHOLARLY',
            url: 'https://scholar.google.com/citations?user=xyz',
            verifiedAt: new Date('2025-01-01T00:00:00Z'),
            healthStatus: 'HEALTHY',
          },
        ],
        homes: [],
      }),
    ).toBeNull();
  });

  it('rejects a display name that carries a lifespan', () => {
    expect(
      toPublicResearcherDto({
        id: 'abc',
        displayName: 'Jane Doe (1901-1980)',
        profileLinks: [officialLink],
        homes: [],
      }),
    ).toBeNull();
  });

  it('drops non-public profile-link URLs', () => {
    const dto = toPublicResearcherDto({
      id: 'abc',
      displayName: 'Dr Local Host',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'http://localhost/profile',
          verifiedAt: new Date('2025-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      homes: [home()],
    });
    expect(dto).not.toBeNull();
    expect(dto?.officialProfileUrl).toBeUndefined();
  });
});
