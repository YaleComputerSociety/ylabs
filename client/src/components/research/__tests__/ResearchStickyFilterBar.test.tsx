import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchStickyFilterBar, {
  STICKY_FILTER_BAR_HEIGHT_PROPERTY,
} from '../ResearchStickyFilterBar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderInsideScrollContainer = () =>
  render(
    <div data-scroll-container>
      <ResearchStickyFilterBar>
        <button type="button">Filters</button>
      </ResearchStickyFilterBar>
    </div>,
  );

describe('ResearchStickyFilterBar', () => {
  it('reserves its own height at the top of the page scroller so focus is not scrolled under it', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(52);

    const { container, unmount } = renderInsideScrollContainer();
    const scrollContainer = container.querySelector<HTMLElement>('[data-scroll-container]')!;

    expect(scrollContainer.style.getPropertyValue(STICKY_FILTER_BAR_HEIGHT_PROPERTY)).toBe('52px');

    unmount();
    expect(scrollContainer.style.getPropertyValue(STICKY_FILTER_BAR_HEIGHT_PROPERTY)).toBe('');
  });
});
