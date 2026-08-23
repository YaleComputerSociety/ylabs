/**
 * Shared keyboard focus-visible ring for navigation chrome controls (WCAG 2.4.7).
 */
export const navFocusRingSx = {
  '&:focus-visible': {
    outline: '2px solid rgba(0, 53, 107, 0.45)',
    outlineOffset: '2px',
  },
} as const;
