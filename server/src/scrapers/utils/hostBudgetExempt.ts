export const HOST_BUDGET_EXEMPT_KEY = '__scraperHostBudgetExempt';

/**
 * A request to a paid model API is not a page fetch: the provider meters it, so the per-host page
 * budget, pause and refusal record leave it alone rather than queue model calls four at a time.
 */
export const HOST_BUDGET_EXEMPT = { [HOST_BUDGET_EXEMPT_KEY]: true } as const;

export function isHostBudgetExempt(config: unknown): boolean {
  return (config as Record<string, unknown> | undefined)?.[HOST_BUDGET_EXEMPT_KEY] === true;
}
