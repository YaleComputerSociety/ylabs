import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HomeButton from '../HomeButton';
import { isResearchHomeResetState } from '../researchHomeNavigation';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="reset-intent">{String(isResearchHomeResetState(location.state))}</span>
    </div>
  );
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <HomeButton />
      <LocationProbe />
    </MemoryRouter>,
  );

describe('HomeButton', () => {
  it('routes the Yale Research logo to the research discovery surface', () => {
    renderAt('/programs');

    expect(screen.getByRole('link', { name: /Yale Research/i }).getAttribute('href')).toBe(
      '/research',
    );
  });

  it('drops the active query instead of reloading it when clicked from search results', async () => {
    renderAt('/research?q=neuroscience&school=Yale%20College');

    await userEvent.click(screen.getByRole('link', { name: /Yale Research/i }));

    expect(screen.getByTestId('pathname').textContent).toBe('/research');
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('carries a reset intent when already on the bare research home', async () => {
    renderAt('/research');

    await userEvent.click(screen.getByRole('link', { name: /Yale Research/i }));

    expect(screen.getByTestId('reset-intent').textContent).toBe('true');
  });

  it('omits the reset intent when the URL itself carries the search to clear', async () => {
    renderAt('/research?q=neuroscience');

    await userEvent.click(screen.getByRole('link', { name: /Yale Research/i }));

    expect(screen.getByTestId('reset-intent').textContent).toBe('false');
  });
});
