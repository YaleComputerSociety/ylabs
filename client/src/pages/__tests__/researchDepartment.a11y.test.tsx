import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchDepartment from '../researchDepartment';
import axios from '../../utils/axios';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../notFound', () => ({
  default: () => <main><h1>Page not found</h1></main>,
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const payload = {
  department: { slug: 'chemistry', label: 'Chemistry' },
  totalHomeCount: 1,
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

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/research/department/chemistry']}>
      <main id="main-content">
        <Routes>
          <Route path="/research/department/:slug" element={<ResearchDepartment />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('department research page accessibility', () => {
  it('has no serious or critical axe violations in the loaded state', async () => {
    mockedAxios.get.mockResolvedValue({ data: payload });
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1, name: /research in chemistry/i });
    await expectNoAxeViolations(container);
  });

  it('exposes an accessible loading status', async () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(
      await screen.findByRole('status', { name: /loading department research/i }),
    ).toBeTruthy();
  });

  it('has no serious or critical axe violations in the empty state', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        department: { slug: 'anthropology', label: 'Anthropology' },
        totalHomeCount: 0,
        totalWayInCount: 0,
        homeGroups: [],
        waysIn: [],
      },
    });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: /no research homes indexed yet/i });
    await expectNoAxeViolations(container);
  });
});
