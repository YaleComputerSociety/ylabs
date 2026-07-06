import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FavoriteButton from '../FavoriteButton';

describe('FavoriteButton', () => {
  it('keeps the default icon-only favorite control large enough for touch input', () => {
    render(<FavoriteButton isFavorite={false} onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Add to favorites' });

    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });
});
