import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ResearchHomeComparison from '../ResearchHomeComparison';
import { trackResearchEvent } from '../../../utils/researchAnalytics';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../../../utils/researchAnalytics', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  );
  return { ...actual, trackResearchEvent: vi.fn().mockResolvedValue(undefined) };
});

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };
const mockedTrack = trackResearchEvent as unknown as ReturnType<typeof vi.fn>;

const entityA = {
  _id: 'a',
  slug: 'lab-a',
  name: 'Lab A',
  school: 'School of Engineering',
  departments: ['Computer Science'],
  researchAreas: ['Robotics', 'Vision'],
  shortDescription: 'Studies autonomous robots.',
  websiteUrl: 'https://engineering.example.edu/lab-a',
  sourceUrls: [],
  currentUndergradCount: 3,
};

const entityB = {
  _id: 'b',
  slug: 'lab-b',
  name: 'Lab B',
  school: '',
  departments: [],
  researchAreas: [],
  shortDescription: '',
  websiteUrl: '',
  sourceUrls: [],
};

const mockDetailBySlug = (bySlug: Record<string, unknown>) => {
  mockedAxios.get.mockImplementation((url: string) => {
    const slug = url.replace('/research/', '');
    const entity = bySlug[slug];
    if (!entity) return Promise.reject(new Error('not found'));
    return Promise.resolve({ data: { researchEntity: entity } });
  });
};

const selection = [
  { _id: 'a', slug: 'lab-a', name: 'Lab A' },
  { _id: 'b', slug: 'lab-b', name: 'Lab B' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchHomeComparison', () => {
  it('renders one column per entity with claim-specific rows and neutral unknowns', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Lab A' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lab B' })).toBeTruthy();
    expect(screen.getByText('School of Engineering')).toBeTruthy();
    expect(screen.getByText(/robotics/i)).toBeTruthy();
    expect(screen.getByText('Studies autonomous robots.')).toBeTruthy();

    await waitFor(() => expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0));
  });

  it('links each column header to the canonical research profile and dedupes repeated entities', async () => {
    mockDetailBySlug({ 'lab-a': entityA });

    render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={[
            { _id: 'a', slug: 'lab-a', name: 'Lab A' },
            { _id: 'a', slug: 'lab-a', name: 'Lab A' },
          ]}
          notesByEntityId={{}}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    const links = await screen.findAllByRole('link', { name: 'Lab A' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/research/lab-a');
  });

  it('excludes private notes until the per-column opt-in is checked', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={selection}
          notesByEntityId={{ a: 'Ask about summer rotations' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    expect(screen.queryByText('Ask about summer rotations')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include my private note' }));
    expect(await screen.findByText('Ask about summer rotations')).toBeTruthy();
  });

  it('emits a single research_compare event with the count bucket on open', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedTrack).toHaveBeenCalledTimes(1));
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'research_compare',
        payload: { entityCountBucket: '2' },
      }),
    );
  });

  it('closes on the close control', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={onClose} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
