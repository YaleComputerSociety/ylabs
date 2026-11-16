// Changing this set also requires updating the host budget paragraph in `skills/scrapers/SKILL.md`.
export const MODEL_API_HOSTS_EXEMPT_FROM_HOST_BUDGET: ReadonlySet<string> = new Set([
  'api.openai.com',
]);

export function isHostBudgetExempt(host: string | undefined): boolean {
  return host !== undefined && MODEL_API_HOSTS_EXEMPT_FROM_HOST_BUDGET.has(host);
}
