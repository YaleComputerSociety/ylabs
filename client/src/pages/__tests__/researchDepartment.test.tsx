import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../utils/axios';
import ResearchDepartmentPage from '../researchDepartment';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const renderDepartmentPage = (slug = 'chemistry') =>
  render(
    <MemoryRouter initialEntries={[`/research/department/${slug}`]}>
      <Routes>
        <Route path="/research/department/:slug" element={<ResearchDepartmentPage />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResearchDepartmentPage', () => {
  it('renders entities grouped by research-type bucket and a ways-in section', async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        department: 'Chemistry',
        slug: 'chemistry',
        estimatedTotalHits: 2,
        entities: [
          { slug: 'ames-lab', name: 'Ames Lab', entityType: 'LAB', shortDescription: 'Studies catalysis.' },
          {
            slug: 'chem-ra-program',
            name: 'Chemistry RA Program',
            entityType: 'RA_PROGRAM',
            shortDescription: 'Paid research assistantships for undergraduates.',
          },
        ],
      },
    });

    renderDepartmentPage();

    expect(await screen.findByRole('heading', { name: 'Chemistry', level: 1 })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'How students join research in Chemistry' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ames Lab' })).toHaveAttribute(
      'href',
      '/research/ames-lab',
    );
    expect(screen.getAllByRole('link', { name: 'Chemistry RA Program' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Chemistry RA Program' })).toHaveAttribute(
      'href',
      '/research/chem-ra-program',
    );
    expect(
      screen.getByRole('link', { name: /Browse all Chemistry research/ }),
    ).toHaveAttribute('href', '/research?department=Chemistry');
  });

  it('renders a sparse empty state when the department has no indexed research homes', async () => {
    (axios.get as any).mockResolvedValue({
      data: { department: 'Underwater Basket Weaving', slug: 'ubw', estimatedTotalHits: 0, entities: [] },
    });

    renderDepartmentPage('ubw');

    expect(
      await screen.findByText('No indexed research homes yet for Underwater Basket Weaving.'),
    ).toBeVisible();
  });

  it('renders a not-found state for an unknown department slug', async () => {
    (axios.get as any).mockRejectedValue({ response: { status: 404 } });

    renderDepartmentPage('not-a-real-department');

    expect(await screen.findByRole('heading', { name: /couldn't find that department/i })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse all research' })).toHaveAttribute(
      'href',
      '/research',
    );
  });
});
