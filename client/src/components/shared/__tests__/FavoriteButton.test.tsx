import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FavoriteButton, { watchControlLabel } from '../FavoriteButton';

describe('FavoriteButton', () => {
  it('keeps the default icon-only favorite control large enough for touch input', () => {
    render(<FavoriteButton isFavorite={false} onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Watch' });

    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });

  it('names the program a watch control acts on', () => {
    expect(watchControlLabel('Summer Fellowship', false)).toBe('Watch Summer Fellowship');
    expect(watchControlLabel('Summer Fellowship', true)).toBe('Stop watching Summer Fellowship');
  });
});
