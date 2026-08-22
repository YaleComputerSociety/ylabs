const DASH_VARIANTS = /[‒–—―−]/g;

export function normalizeResearchEntityNameDashes(value: string): string {
  if (typeof value !== 'string') return value;
  const converted = value.replace(DASH_VARIANTS, '-');
  if (converted === value) return value;
  return converted.replace(/[ \t]{2,}/g, ' ');
}
