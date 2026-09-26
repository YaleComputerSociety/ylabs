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
  it('routes the y/labs logo to the research discovery surface', () => {
    renderAt('/programs');

    expect(screen.getByRole('link', { name: /y\/labs/i }).getAttribute('href')).toBe('/research');
  });

  it('drops the active query instead of reloading it when clicked from search results', async () => {
    renderAt('/research?q=neuroscience&school=Yale%20College');

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('pathname').textContent).toBe('/research');
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('carries a reset intent when already on the bare research home', async () => {
    renderAt('/research');

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('reset-intent').textContent).toBe('true');
  });

  it('carries a reset intent from search results, where page state can outlive the URL', async () => {
    renderAt('/research?q=neuroscience');

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('reset-intent').textContent).toBe('true');
  });

  it('carries a reset intent from an entity page, where the snapshot can restore a draft', async () => {
    renderAt('/research/ai-safety-lab');

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('pathname').textContent).toBe('/research');
    expect(screen.getByTestId('reset-intent').textContent).toBe('true');
  });
});
