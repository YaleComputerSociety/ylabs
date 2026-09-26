import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import YURAButton from '../YURAButton';
import { isResearchHomeResetState } from '../researchHomeNavigation';

afterEach(() => {
  cleanup();
});

const LocationProbe = () => {
  const location = useLocation();
  return (
    <>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <span data-testid="reset-intent">{String(isResearchHomeResetState(location.state))}</span>
    </>
  );
};

describe('YURAButton', () => {
  it('routes the logged-out logo to the public research home', () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <YURAButton />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /y\/labs/i }).getAttribute('href')).toBe('/research');
  });

  it('clears the query for logged-out visitors instead of reloading it', async () => {
    render(
      <MemoryRouter initialEntries={['/research?q=neuroscience']}>
        <YURAButton />
        <LocationProbe />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('location').textContent).toBe('/research');
  });

  it('carries a reset intent from an entity page for logged-out visitors', async () => {
    render(
      <MemoryRouter initialEntries={['/research/ai-safety-lab']}>
        <YURAButton />
        <LocationProbe />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: /y\/labs/i }));

    expect(screen.getByTestId('location').textContent).toBe('/research');
    expect(screen.getByTestId('reset-intent').textContent).toBe('true');
  });
});
