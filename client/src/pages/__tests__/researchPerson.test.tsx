import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchPerson from '../researchPerson';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import type { ResearcherProfilePayload } from '../../types/researcherProfile';
import type { ResearchEntity } from '../../types/researchEntity';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const PUBLIC_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6-pi';

const home = (slug: string, name: string): ResearchEntity =>
  ({
    _id: slug,
    id: slug,
    slug,
    name,
    kind: 'lab',
    entityType: 'LAB',
    shortDescription: `The ${name} studies molecular systems and cellular signaling.`,
    fullDescription: `The ${name} studies molecular systems and cellular signaling in depth.`,
    departments: ['Cell Biology'],
    researchAreas: ['Molecular biology'],
    sourceUrls: ['https://example.yale.edu/lab'],
    school: 'School of Medicine',
  }) as unknown as ResearchEntity;

const basePayload: ResearcherProfilePayload = {
  publicKey: PUBLIC_KEY,
  displayName: 'Dr Ada Researcher',
  title: 'Professor of Cell Biology',
  primaryDepartment: 'Cell Biology',
  school: 'School of Medicine',
  officialProfileUrl: 'https://medicine.yale.edu/profile/ada-researcher',
  scholarUrl: 'https://scholar.google.com/citations?user=abc123DEF',
  homes: [home('ada-lab', 'Ada Lab'), home('ada-center', 'Ada Center')],
};

function renderPerson(
  payload: ResearcherProfilePayload | { status: number } = basePayload,
): ReturnType<typeof render> {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === `/research/person/${PUBLIC_KEY}`) {
      if ('status' in payload) {
        return Promise.reject({ response: { status: payload.status } });
      }
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return render(
    <ConfigContext.Provider value={defaultConfigContext}>
      <MemoryRouter initialEntries={[`/research/person/${PUBLIC_KEY}`]}>
        <Routes>
          <Route path="/research/person/:publicKey" element={<ResearchPerson />} />
        </Routes>
      </MemoryRouter>
    </ConfigContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchPerson', () => {
  it('renders the identity block and every research home', async () => {
    renderPerson();

    const heading = await screen.findByRole('heading', { name: 'Dr Ada Researcher' });
    const header = heading.closest('header') as HTMLElement;
    expect(within(header).getByText('Professor of Cell Biology')).toBeInTheDocument();
    expect(within(header).getByText('Cell Biology · School of Medicine')).toBeInTheDocument();

    const officialLink = within(header).getByRole('link', { name: 'View official profile' });
    expect(officialLink).toHaveAttribute(
      'href',
      'https://medicine.yale.edu/profile/ada-researcher',
    );
    expect(screen.getByRole('link', { name: 'Google Scholar' })).toBeInTheDocument();

    expect(screen.getByText('Ada Lab')).toBeInTheDocument();
    expect(screen.getByText('Ada Center')).toBeInTheDocument();
  });

  it('renders correctly for a single-home researcher and hides missing fields', async () => {
    renderPerson({
      publicKey: PUBLIC_KEY,
      displayName: 'Dr Solo Lead',
      homes: [home('solo-lab', 'Solo Lab')],
    });

    expect(await screen.findByRole('heading', { name: 'Dr Solo Lead' })).toBeInTheDocument();
    expect(screen.getByText('Solo Lab')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View official profile' })).not.toBeInTheDocument();
    expect(screen.queryByText('Professor of Cell Biology')).not.toBeInTheDocument();
  });

  it('shows the not-found page when the key resolves to nothing', async () => {
    renderPerson({ status: 404 });

    expect(await screen.findByText(/We couldn't find that Yale Research page/i)).toBeInTheDocument();
  });
});
