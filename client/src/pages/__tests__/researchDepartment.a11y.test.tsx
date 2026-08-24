import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, vi } from 'vitest';

import axios from '../../utils/axios';
import ResearchDepartmentPage from '../researchDepartment';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const renderDepartmentPage = (slug = 'chemistry') =>
  render(
    <MemoryRouter initialEntries={[`/research/department/${slug}`]}>
      <Routes>
        <Route path="/research/department/:slug" element={<ResearchDepartmentPage />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('department research page accessibility', () => {
  it('has no serious or critical axe violations when populated', async () => {
    mockedAxios.get.mockResolvedValue({
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

    const { container } = renderDepartmentPage();
    await screen.findByRole('heading', { name: 'Chemistry', level: 1 });
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations in the not-found state', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404 } });

    const { container } = renderDepartmentPage('not-a-real-department');
    await screen.findByRole('heading', { name: /couldn't find that department/i });
    await expectNoAxeViolations(container);
  });
});
