import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import NotFound from '../notFound';

const renderNotFound = () =>
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      screen.getByRole('heading', { name: /we couldn't find that yale research page/i }),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: /explore yale research/i });
    expect(link.getAttribute('href')).toBe('/research');
    expect(screen.getByRole('link', { name: /browse pathways/i }).getAttribute('href')).toBe(
      '/pathways',
    );
    expect(screen.getByRole('link', { name: /posted opportunities/i }).getAttribute('href')).toBe(
      '/listings',
    );
  });
});
