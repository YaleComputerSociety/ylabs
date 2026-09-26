import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
});
