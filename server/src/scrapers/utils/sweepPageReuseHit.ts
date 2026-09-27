export const SWEEP_PAGE_REUSE_HIT_KEY = '__scraperSweepPageReuseHit';

export function isSweepPageReuseHit(config: unknown): boolean {
  return (config as Record<string, unknown> | undefined)?.[SWEEP_PAGE_REUSE_HIT_KEY] === true;
}
