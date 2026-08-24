import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ResearchInterestsEditor from '../ResearchInterestsEditor';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

vi.mock('../../../hooks/useConfig', () => ({
  default: () => ({
    researchAreas: [
      { name: 'Machine Learning', field: 'Computing & Artificial Intelligence' },
      { name: 'Statistics', field: 'Mathematics' },
    ],
  }),
}));

vi.mock('../../research/ResearchAreaTypeahead', () => ({
  default: ({ onSelect }: { onSelect: (value: string) => void }) => (
    <button type="button" onClick={() => onSelect('Statistics')}>
      add-statistics
    </button>
  ),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const renderEditor = () =>
  render(
    <MemoryRouter>
      <ResearchInterestsEditor />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchInterestsEditor', () => {
  it('loads and renders the saved interests', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { researchInterests: ['Machine Learning'], graduationYear: 2027 },
    });
    renderEditor();

    expect(await screen.findByText('Machine Learning')).toBeTruthy();
    expect(mockedAxios.get).toHaveBeenCalledWith('/users/researchInterests');
  });

  it('adds an interest and persists the full signal on save', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { researchInterests: ['Machine Learning'], graduationYear: 2027 },
    });
    mockedAxios.put.mockResolvedValue({
      data: { researchInterests: ['Machine Learning', 'Statistics'], graduationYear: 2027 },
    });
    renderEditor();

    await screen.findByText('Machine Learning');
    fireEvent.click(screen.getByText('add-statistics'));
    expect(await screen.findByText('Statistics')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save interests' }));

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/researchInterests', {
        data: { researchInterests: ['Machine Learning', 'Statistics'], graduationYear: 2027 },
      }),
    );
    expect(await screen.findByText('Interests saved.')).toBeTruthy();
  });

  it('removes an interest', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { researchInterests: ['Machine Learning'], graduationYear: null },
    });
    renderEditor();

    await screen.findByText('Machine Learning');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Machine Learning' }));

    await waitFor(() => expect(screen.queryByText('Machine Learning')).toBeNull());
  });
});
