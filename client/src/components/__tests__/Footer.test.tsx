import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import Footer from '../Footer';

const renderFooter = () =>
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );

describe('Footer', () => {
  it('keeps sponsor logo links at the WCAG 2.5.8 target minimum', () => {
    renderFooter();

    ['Hudson River Trading', 'MiniMax'].forEach((name) => {
      const link = screen.getByRole('link', { name });

      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('min-w-[44px]');
    });
  });

  it('links the privacy notice from every page (#4157)', () => {
    renderFooter();

    const link = screen.getByRole('link', { name: 'Privacy' });
    expect(link.getAttribute('href')).toBe('/privacy');
    expect(link.className).toContain('min-h-[44px]');
  });
});
