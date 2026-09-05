import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import YURAButton from '../YURAButton';

afterEach(() => {
  cleanup();
});

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
};

describe('YURAButton', () => {
  it('routes the logged-out logo to the public research home', () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <YURAButton />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Yale Research/i }).getAttribute('href')).toBe(
      '/research',
    );
  });

  it('clears the query for logged-out visitors instead of reloading it', async () => {
    render(
      <MemoryRouter initialEntries={['/research?q=neuroscience']}>
        <YURAButton />
        <LocationProbe />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: /Yale Research/i }));

    expect(screen.getByTestId('location').textContent).toBe('/research');
  });
});
