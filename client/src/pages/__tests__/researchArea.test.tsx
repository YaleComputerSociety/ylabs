import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchAreaPage } from '../researchArea';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import type { ResearchEntity } from '../../types/researchEntity';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const home = (slug: string, name: string, entityType: string): ResearchEntity =>
  ({
    _id: slug,
    id: slug,
    slug,
    name,
    kind: 'lab',
    entityType,
    shortDescription: `The ${name} studies the neural basis of memory and perception.`,
    fullDescription: `The ${name} studies the neural basis of memory and perception in depth.`,
    departments: ['Neuroscience'],
    researchAreas: ['Neuroscience'],
    sourceUrls: ['https://example.yale.edu/lab'],
    school: 'School of Medicine',
  }) as unknown as ResearchEntity;

const populatedPayload = {
  scope: {
    kind: 'area' as const,
    slug: 'neuroscience',
    name: 'Neuroscience',
    colorKey: 'red',
    field: 'Life Sciences & Biology',
  },
  buckets: [
    {
      key: 'labs',
      label: 'Research groups & labs',
      researchEntities: [home('memory-lab', 'Memory Lab', 'LAB')],
      totalCount: 1,
    },
    {
      key: 'centers',
      label: 'Centers & institutes',
      researchEntities: [home('brain-institute', 'Brain Institute', 'INSTITUTE')],
      totalCount: 1,
    },
  ],
  totalCount: 2,
  waysIn: {
    researchEntities: [home('memory-lab', 'Memory Lab', 'LAB')],
    totalCount: 1,
  },
};

function renderArea(
  payload: unknown | { status: number } = populatedPayload,
  slug = 'neuroscience',
): ReturnType<typeof render> {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === `/research/area/${slug}`) {
      if (payload && typeof payload === 'object' && 'status' in (payload as object)) {
        return Promise.reject({ response: { status: (payload as { status: number }).status } });
      }
      return Promise.resolve({ data: payload });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return render(
    <ConfigContext.Provider value={defaultConfigContext}>
      <MemoryRouter initialEntries={[`/research/area/${slug}`]}>
        <Routes>
          <Route path="/research/area/:slug" element={<ResearchAreaPage />} />
        </Routes>
      </MemoryRouter>
    </ConfigContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchArea page', () => {
  it('renders the area header, bucketed homes, and the ways-in section', async () => {
    renderArea();

    expect(await screen.findByRole('heading', { name: 'Neuroscience' })).toBeInTheDocument();
    expect(screen.getByText('Research groups & labs (1)')).toBeInTheDocument();
    expect(screen.getByText('Centers & institutes (1)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Research homes (2)' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Ways into Neuroscience research (1)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Neuroscience in search/ })).toBeInTheDocument();
  });

  it('degrades gracefully for a sparse area with a single populated bucket and no ways in', async () => {
    renderArea({
      scope: { kind: 'area', slug: 'neuroscience', name: 'Neuroscience', colorKey: 'red' },
      buckets: [
        {
          key: 'labs',
          label: 'Research groups & labs',
          researchEntities: [home('memory-lab', 'Memory Lab', 'LAB')],
          totalCount: 1,
        },
      ],
      totalCount: 1,
      waysIn: { researchEntities: [], totalCount: 0 },
    });

    expect(await screen.findByRole('heading', { name: 'Neuroscience' })).toBeInTheDocument();
    expect(screen.getByText('Research groups & labs (1)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Ways into/ })).not.toBeInTheDocument();
  });

  it('shows an honest empty state when the area has no indexed homes', async () => {
    renderArea({
      scope: { kind: 'area', slug: 'neuroscience', name: 'Neuroscience', colorKey: 'red' },
      buckets: [],
      totalCount: 0,
      waysIn: { researchEntities: [], totalCount: 0 },
    });

    expect(await screen.findByText('No research homes indexed yet')).toBeInTheDocument();
  });

  it('renders the not-found page for an unknown slug', async () => {
    renderArea({ status: 404 });
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: 'Neuroscience' })).not.toBeInTheDocument();
  });
});
