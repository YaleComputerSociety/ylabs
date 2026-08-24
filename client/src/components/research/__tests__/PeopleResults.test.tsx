import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeopleResults from '../PeopleResults';
import axios from '../../../utils/axios';
import type { ResearcherSearchHit } from '../../../types/researcherSearch';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() },
}));

const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const PERSON_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';

const hit = (overrides: Partial<ResearcherSearchHit> = {}): ResearcherSearchHit => ({
  id: PERSON_ID,
  publicKey: PERSON_ID,
  displayName: 'Dr Ada Researcher',
  title: 'Professor of Cell Biology',
  primaryDepartment: 'Cell Biology',
  school: 'School of Medicine',
  homeCount: 2,
  ...overrides,
});

const renderResults = (query: string, hits: ResearcherSearchHit[]) => {
  mockedAxios.post.mockResolvedValue({
    data: { hits, estimatedTotalHits: hits.length, page: 1, pageSize: 6 },
  });
  return render(
    <MemoryRouter>
      <PeopleResults query={query} />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PeopleResults', () => {
  it('renders matching researchers with a link to the person page', async () => {
    renderResults('ada', [hit()]);

    const link = await screen.findByRole('link', { name: /Dr Ada Researcher/ });
    expect(link).toHaveAttribute('href', `/research/person/${PERSON_ID}`);
    expect(screen.getByText(/Professor of Cell Biology · Cell Biology · School of Medicine/)).toBeTruthy();
    expect(screen.getByText('Leads 2 research homes')).toBeTruthy();
  });

  it('labels a home-less researcher as findable', async () => {
    renderResults('ada', [hit({ homeCount: 0 })]);
    expect(await screen.findByText('Findable researcher')).toBeTruthy();
  });

  it('renders nothing when there are no researcher hits', async () => {
    const { container } = renderResults('ada', []);
    await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('does not query for a blank query', () => {
    render(
      <MemoryRouter>
        <PeopleResults query="   " />
      </MemoryRouter>,
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
