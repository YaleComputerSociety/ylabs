/**
 * Shared keyboard focus-visible ring for navigation chrome controls (WCAG 2.4.7).
 */
// Matches .yr-focus-ring in index.css so MUI chrome and Tailwind controls share one ring colour.
// The former rgba(0, 53, 107, 0.45) flattened to 2.47:1 on the page, under the 3:1 floor of WCAG 1.4.11.
const FOCUS_RING_OUTLINE = '2px solid color-mix(in srgb, var(--yr-blue) 72%, white)';

export const navFocusRingSx = {
  '&:focus-visible': {
    outline: FOCUS_RING_OUTLINE,
    outlineOffset: '2px',
  },
} as const;

// Negative offset because a popover's scroll container clips an outset outline away.
export const menuItemFocusRingSx = {
  '&:focus-visible': {
    outline: FOCUS_RING_OUTLINE,
    outlineOffset: '-2px',
  },
} as const;
