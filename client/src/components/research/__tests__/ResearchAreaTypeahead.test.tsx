import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchAreaTypeahead from '../ResearchAreaTypeahead';

afterEach(() => {
  cleanup();
});

describe('ResearchAreaTypeahead', () => {
  it('renders the combobox input at a 16px-safe font size to avoid iOS focus-zoom', () => {
    render(
      <ResearchAreaTypeahead
        options={[{ value: 'Genomics', count: 3 }]}
        hasSelections={false}
        onSelect={vi.fn()}
      />,
    );

    const input = screen.getByRole('combobox');

    expect(input.className).toContain('text-base');
    expect(input.className).not.toContain('text-sm');
  });
});
