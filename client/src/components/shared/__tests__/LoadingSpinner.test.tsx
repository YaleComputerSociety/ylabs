import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoadingSpinner from '../LoadingSpinner';

const spinnerDots = (container: HTMLElement): number =>
  container.querySelectorAll('span > span').length;

describe('LoadingSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A response faster than the threshold must never paint a spinner, because a
   * single frame of spinner reads as a glitch rather than as progress.
   */
  it('paints nothing before the show threshold', () => {
    const { container } = render(<LoadingSpinner />);

    expect(spinnerDots(container)).toBe(0);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(spinnerDots(container)).toBe(0);
  });

  it('paints once the show threshold passes', () => {
    const { container } = render(<LoadingSpinner />);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(spinnerDots(container)).toBeGreaterThan(0);
  });

  it('paints immediately when deferral is switched off', () => {
    const { container } = render(<LoadingSpinner deferred={false} />);

    expect(spinnerDots(container)).toBeGreaterThan(0);
  });

  /** The container reserves its height so the surface does not jump on arrival. */
  it('reserves height while deferred so nothing shifts', () => {
    const { container } = render(<LoadingSpinner />);

    expect(container.querySelector('.min-h-\\[2\\.5rem\\]')).not.toBeNull();
  });
});
