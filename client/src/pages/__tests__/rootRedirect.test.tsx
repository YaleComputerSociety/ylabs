import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import RootRedirect from '../rootRedirect';

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/research" element={<LocationProbe />} />
        <Route path="/listings" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('RootRedirect', () => {
  it('sends the authenticated root route to research discovery', () => {
    renderAt('/');

    expect(screen.getByTestId('location').textContent).toBe('/research');
  });

  it('preserves old direct listing modal links on the legacy listings route', () => {
    renderAt('/?listing=abc123');

    expect(screen.getByTestId('location').textContent).toBe('/listings?listing=abc123');
  });
});
