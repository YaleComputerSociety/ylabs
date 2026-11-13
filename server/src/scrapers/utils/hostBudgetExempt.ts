/**
 * The model API hosts this codebase calls. A request to one is not a page fetch: the provider
 * meters it and the caller handles its refusals, so the per-host page budget, pause and refusal
 * record leave it alone rather than queue model calls four at a time. The match is on the exact
 * hostname, so no config flag and no lookalike host such as `api.openai.com.evil.example` can
 * opt a scraped page out of the budget. Changing it also requires updating the host budget
 * paragraph in `skills/scrapers/SKILL.md`.
 */
export const MODEL_API_HOSTS_EXEMPT_FROM_HOST_BUDGET: ReadonlySet<string> = new Set([
  'api.openai.com',
]);

export function isHostBudgetExempt(host: string | undefined): boolean {
  return host !== undefined && MODEL_API_HOSTS_EXEMPT_FROM_HOST_BUDGET.has(host);
}
