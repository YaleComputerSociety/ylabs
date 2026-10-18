import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import NotFound from '../notFound';

const renderNotFound = () =>
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('NotFound', () => {
  it('points lost students back to Explore Research', () => {
    renderNotFound();

    expect(
      screen.getByRole('heading', { name: /we couldn't find that y\/labs page/i }),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: /explore research/i });
    expect(link.getAttribute('href')).toBe('/research');
  });

  it('prefills a search from the missing address and runs it on research', () => {
    const LocationProbe = () => {
      const location = useLocation();
      return (
        <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>
      );
    };
    render(
      <MemoryRouter initialEntries={['/research/missing-example']}>
        <Routes>
          <Route path="/research/:slug" element={<NotFound suggestedQuery="example imaging" />} />
          <Route path="/research" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const searchBox = screen.getByRole('searchbox', { name: 'Search y/labs' });
    expect(searchBox).toHaveValue('example imaging');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByLabelText('Current location').textContent).toBe(
      '/research?q=example%20imaging',
    );
  });
});
