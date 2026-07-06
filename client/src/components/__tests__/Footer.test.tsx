import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Footer from '../Footer';

describe('Footer', () => {
  it('keeps sponsor logo links at the WCAG 2.5.8 target minimum', () => {
    render(<Footer />);

    ['Hudson River Trading', 'MiniMax'].forEach((name) => {
      const link = screen.getByRole('link', { name });

      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('min-w-[44px]');
    });
  });
});
