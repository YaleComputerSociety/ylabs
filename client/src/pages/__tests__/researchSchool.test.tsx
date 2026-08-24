import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchSchool from '../researchSchool';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../notFound', () => ({
  default: () => <div data-testid="not-found-page">Page not found</div>,
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const medicinePayload = {
  school: { slug: 'school-of-medicine', label: 'School of Medicine' },
  totalHomeCount: 1,
  totalWayInCount: 1,
  departments: [
    { slug: 'genetics', label: 'Genetics', homeCount: 3 },
    { slug: 'immunobiology', label: 'Immunobiology', homeCount: 1 },
  ],
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

const renderPage = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/research/school/${slug}`]}>
      <Routes>
        <Route path="/research/school/:slug" element={<ResearchSchool />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchSchool page', () => {
  it('renders departments, cross-cutting centers, homes, and a ways-in section', async () => {
    mockedAxios.get.mockResolvedValue({ data: medicinePayload });

    renderPage('school-of-medicine');

    expect(
      await screen.findByRole('heading', { level: 1, name: /research at school of medicine/i }),
    ).toBeTruthy();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      '/research/school/school-of-medicine',
      expect.objectContaining({ signal: expect.anything() }),
    );

    const departmentLink = screen.getByRole('link', { name: /genetics/i });
    expect(departmentLink.getAttribute('href')).toBe('/research/department/genetics');

    expect(
      screen.getByRole('heading', { name: /cross-cutting centers and institutes/i }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: /research homes \(1\)/i })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /how students join research at school of medicine/i }),
    ).toBeTruthy();

    expect(
      screen.getByRole('link', { name: 'Gene Regulation Lab' }).getAttribute('href'),
    ).toBe('/research/gene-regulation-lab');

    const browseLink = screen.getByRole('link', { name: /browse school of medicine in search/i });
    expect(browseLink.getAttribute('href')).toBe('/research?school=School%20of%20Medicine');
  });

  it('renders an honest empty state with a browse CTA when nothing is indexed', async () => {
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

    renderPage('divinity-school');

    expect(
      await screen.findByRole('heading', { name: /no research homes indexed yet/i }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to browse research/i })).toBeTruthy();
  });

  it('renders NotFound on a 404 response', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

    renderPage('not-a-real-school');

    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeTruthy();
    });
  });
});
