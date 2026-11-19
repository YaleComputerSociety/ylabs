import { describe, expect, it } from 'vitest';

import { placeAgainstViewport } from '../useViewportFitPlacement';

const visible = { top: 68, bottom: 768 };

describe('placeAgainstViewport', () => {
  it('opens below and caps the height to the room left when the trigger sits high', () => {
    expect(placeAgainstViewport({ top: 120, bottom: 164 }, visible)).toEqual({
      side: 'below',
      maxHeight: 768 - 164 - 4 - 8,
    });
  });

  it('flips above a trigger near the bottom edge so the panel never runs off-screen', () => {
    expect(placeAgainstViewport({ top: 636, bottom: 680 }, visible)).toEqual({
      side: 'above',
      maxHeight: 636 - 68 - 4 - 8,
    });
  });

  it('keeps the panel below the sticky header rather than under it', () => {
    const { side, maxHeight } = placeAgainstViewport({ top: 636, bottom: 680 }, visible);
    expect(side).toBe('above');
    expect(636 - 4 - (maxHeight ?? 0)).toBeGreaterThanOrEqual(visible.top);
  });

  it('stays below when the room under the trigger is comfortable even if more is above', () => {
    expect(placeAgainstViewport({ top: 380, bottom: 400 }, { top: 0, bottom: 800 }).side).toBe(
      'below',
    );
  });
});
