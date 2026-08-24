import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RelatedProgramsModule from '../RelatedProgramsModule';
import axios from '../../../utils/axios';
import { trackResearchEvent, trackResearchEventOnce } from '../../../utils/researchAnalytics';

vi.mock('../../../utils/axios', () => ({
  default: { post: vi.fn() },
}));

vi.mock('../../../utils/researchAnalytics', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  );
  return {
    ...actual,
    trackResearchEvent: vi.fn(),
    trackResearchEventOnce: vi.fn(),
  };
});

const mockedPost = axios.post as unknown as ReturnType<typeof vi.fn>;
const mockedTrackOnce = trackResearchEventOnce as unknown as ReturnType<typeof vi.fn>;
const mockedTrack = trackResearchEvent as unknown as ReturnType<typeof vi.fn>;

const programEntity = {
  _id: 'program-richter',
  slug: 'program-richter',
  name: 'Richter Summer Research Fellowship',
  displayName: 'Richter Summer Research Fellowship',
  kind: 'program',
  entityType: 'FELLOWSHIP_PROGRAM',
  fullDescription: 'Funds independent undergraduate summer research projects.',
  websiteUrl: 'https://funding.yale.edu/richter',
  location: '',
  departments: [],
  researchAreas: ['Independent research'],
  school: 'Yale College',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: ['https://funding.yale.edu/richter'],
};

const renderModule = (query: string) =>
  render(
    <MemoryRouter>
      <RelatedProgramsModule query={query} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RelatedProgramsModule', () => {
  it('renders nothing and does not fetch for a blank query', () => {
    renderModule('   ');

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Related programs and fellowships' })).toBeNull();
  });

  it('surfaces matching programs for a topical query and emits a distinct impression', async () => {
    mockedPost.mockResolvedValue({
      data: { researchEntities: [programEntity], degraded: false },
    });

    renderModule('climate funding');

    await screen.findByRole('heading', { name: 'Richter Summer Research Fellowship' });

    expect(mockedPost).toHaveBeenCalledWith(
      '/research/related-programs',
      expect.objectContaining({ q: 'climate funding' }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(
      screen.getByRole('region', { name: 'Related programs and fellowships' }),
    ).toBeTruthy();

    await waitFor(() => expect(mockedTrackOnce).toHaveBeenCalled());
    const impression = mockedTrackOnce.mock.calls[0][1];
    expect(impression.eventType).toBe('research_entity_impression');
    expect(impression.payload.surface).toBe('related_programs');
  });

  it('renders nothing when the related-programs fetch fails', async () => {
    mockedPost.mockRejectedValue(new Error('network down'));

    renderModule('immunology');

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Related programs and fellowships' }),
      ).toBeNull(),
    );
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});
