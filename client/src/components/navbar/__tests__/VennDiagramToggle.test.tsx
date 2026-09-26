import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import VennDiagramToggle from '../VennDiagramToggle';

const circleColors = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('circle')).flatMap((circle) => [
    circle.getAttribute('stroke') ?? '',
    circle.getAttribute('fill') ?? '',
  ]);

describe('VennDiagramToggle', () => {
  /**
   * These two illustrations are the only SVGs outside the icon set, and they were
   * the last place in the client holding raw hex: green-600, green-100, blue-600,
   * blue-500, gray-400 and gray-300, none of which are in this palette. They are
   * state-driven, so both modes have to be checked rather than one.
   */
  it.each(['union', 'intersection'] as const)('draws %s from palette tokens', (mode) => {
    const { container } = render(<VennDiagramToggle mode={mode} setMode={vi.fn()} />);

    const colors = circleColors(container).filter((value) => value && value !== 'none');

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color, `${mode}: ${color}`).toMatch(/^var\(--yr-[a-z-]+\)$/);
    }
  });

  it('distinguishes the selected mode from the unselected one', () => {
    const union = render(<VennDiagramToggle mode="union" setMode={vi.fn()} />);
    const intersection = render(<VennDiagramToggle mode="intersection" setMode={vi.fn()} />);

    expect(circleColors(union.container)).not.toEqual(circleColors(intersection.container));
  });
});
