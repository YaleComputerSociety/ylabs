import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchDepartment from '../researchDepartment';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../notFound', () => ({
  default: () => <div data-testid="not-found-page">Page not found</div>,
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const chemistryPayload = {
  department: { slug: 'chemistry', label: 'Chemistry' },
  totalHomeCount: 2,
  totalWayInCount: 1,
  homeGroups: [
    {
      entityType: 'LAB',
      label: 'Labs',
      totalCount: 1,
      researchEntities: [
        {
          id: 'e1',
          slug: 'reaction-dynamics-lab',
          name: 'Reaction Dynamics Lab',
          entityType: 'LAB',
          departments: ['Chemistry'],
          researchAreas: ['Physical chemistry'],
          cardDescription: { text: 'Studies reaction dynamics.', state: 'complete', label: '' },
        },
      ],
    },
    {
      entityType: 'CENTER',
      label: 'Centers',
      totalCount: 1,
      researchEntities: [
        {
          id: 'e2',
          slug: 'energy-sciences-center',
          name: 'Energy Sciences Center',
          entityType: 'CENTER',
          departments: ['Chemistry'],
          researchAreas: [],
        },
      ],
    },
  ],
  waysIn: [
    {
      entityType: 'RA_PROGRAM',
      label: 'Research assistant programs',
      totalCount: 1,
      researchEntities: [
        {
          id: 'e3',
          slug: 'chemistry-summer-ra',
          name: 'Chemistry Summer RA Program',
          entityType: 'RA_PROGRAM',
          departments: ['Chemistry'],
          researchAreas: [],
        },
      ],
    },
  ],
};

const renderPage = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/research/department/${slug}`]}>
      <Routes>
        <Route path="/research/department/:slug" element={<ResearchDepartment />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchDepartment page', () => {
  it('renders homes grouped by type and a distinct ways-in section', async () => {
    mockedAxios.get.mockResolvedValue({ data: chemistryPayload });

    renderPage('chemistry');

    expect(
      await screen.findByRole('heading', { level: 1, name: /research in chemistry/i }),
    ).toBeTruthy();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      '/research/department/chemistry',
      expect.objectContaining({ signal: expect.anything() }),
    );

    expect(screen.getByRole('heading', { name: /research homes \(2\)/i })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /how students join research in chemistry/i }),
    ).toBeTruthy();

    const labLink = screen.getByRole('link', { name: 'Reaction Dynamics Lab' });
    expect(labLink.getAttribute('href')).toBe('/research/reaction-dynamics-lab');
    expect(
      screen.getByRole('link', { name: 'Chemistry Summer RA Program' }).getAttribute('href'),
    ).toBe('/research/chemistry-summer-ra');

    const browseLink = screen.getByRole('link', { name: /browse chemistry in search/i });
    expect(browseLink.getAttribute('href')).toBe('/research?dept=Chemistry');
  });

  it('renders an honest empty state with a browse CTA when nothing is indexed', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        department: { slug: 'anthropology', label: 'Anthropology' },
        totalHomeCount: 0,
        totalWayInCount: 0,
        homeGroups: [],
        waysIn: [],
      },
    });

    renderPage('anthropology');

    expect(
      await screen.findByRole('heading', { name: /no research homes indexed yet/i }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to browse research/i })).toBeTruthy();
  });

  it('renders NotFound on a 404 response', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

    renderPage('school-of-medicine');

    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeTruthy();
    });
  });
});
