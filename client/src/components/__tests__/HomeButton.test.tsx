import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import HomeButton from '../HomeButton';

afterEach(() => {
  cleanup();
});

describe('HomeButton', () => {
  it('routes the Yale Research logo to the research discovery surface', () => {
    render(
      <MemoryRouter initialEntries={['/pathways']}>
        <HomeButton />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Yale Research/i }).getAttribute('href')).toBe(
      '/research',
    );
  });
});
