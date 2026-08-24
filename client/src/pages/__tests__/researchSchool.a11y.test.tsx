import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchSchool from '../researchSchool';
import axios from '../../utils/axios';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../notFound', () => ({
  default: () => (
    <main>
      <h1>Page not found</h1>
    </main>
  ),
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const payload = {
  school: { slug: 'school-of-medicine', label: 'School of Medicine' },
  totalHomeCount: 1,
  totalWayInCount: 1,
  departments: [{ slug: 'genetics', label: 'Genetics', homeCount: 1 }],
  crossCuttingGroups: [
    {
      entityType: 'CENTER',
      label: 'Centers',
      totalCount: 1,
      researchEntities: [
        {
          id: 'c1',
          slug: 'cancer-center',
          name: 'Cancer Center',
          entityType: 'CENTER',
          departments: ['Genetics'],
          researchAreas: [],
        },
      ],
    },
  ],
  homeGroups: [
    {
      entityType: 'LAB',
      label: 'Labs',
      totalCount: 1,
      researchEntities: [
        {
          id: 'e1',
          slug: 'gene-regulation-lab',
          name: 'Gene Regulation Lab',
          entityType: 'LAB',
          departments: ['Genetics'],
          researchAreas: ['Genomics'],
          cardDescription: { text: 'Studies gene regulation.', state: 'complete', label: '' },
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
          slug: 'summer-medical-ra',
          name: 'Summer Medical RA Program',
          entityType: 'RA_PROGRAM',
          departments: ['Genetics'],
          researchAreas: [],
        },
      ],
    },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/research/school/school-of-medicine']}>
      <main id="main-content">
        <Routes>
          <Route path="/research/school/:slug" element={<ResearchSchool />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('school research page accessibility', () => {
  it('has no serious or critical axe violations in the loaded state', async () => {
    mockedAxios.get.mockResolvedValue({ data: payload });
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1, name: /research at school of medicine/i });
    await expectNoAxeViolations(container);
  });

  it('exposes an accessible loading status', async () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(
      await screen.findByRole('status', { name: /loading school research/i }),
    ).toBeTruthy();
  });

  it('has no serious or critical axe violations in the empty state', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        school: { slug: 'divinity-school', label: 'Divinity School' },
        totalHomeCount: 0,
        totalWayInCount: 0,
        departments: [],
        crossCuttingGroups: [],
        homeGroups: [],
        waysIn: [],
      },
    });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: /no research homes indexed yet/i });
    await expectNoAxeViolations(container);
  });
});
