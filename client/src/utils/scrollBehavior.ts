const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;

export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');
