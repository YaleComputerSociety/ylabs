const PROFILE_ROLE_LABEL_SUFFIX_RE = /\s*YSM\s+Researchers?\s*$/;
const TRAILING_SEPARATOR_RE = /[\s,;:]+$/;

export const stripProfileRoleLabelSuffix = (value: string): string => {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(PROFILE_ROLE_LABEL_SUFFIX_RE, '');
  if (stripped === value) return value;
  return stripped.replace(TRAILING_SEPARATOR_RE, '');
};

export const sanitizeResearchAreaLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return stripProfileRoleLabelSuffix(collapsed).trim();
};

export const sanitizeResearchAreaLabelList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of values) {
    const cleaned = sanitizeResearchAreaLabel(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(cleaned);
  }
  return labels;
};

export const sanitizeResearchAreaFacetDistribution = (
  distribution: Record<string, number> | undefined,
): Record<string, number> | undefined => {
  if (!distribution) return distribution;
  const merged: Record<string, number> = {};
  for (const [rawKey, rawCount] of Object.entries(distribution)) {
    const cleaned = sanitizeResearchAreaLabel(rawKey);
    if (!cleaned) continue;
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0;
    merged[cleaned] = (merged[cleaned] || 0) + count;
  }
  return merged;
};
