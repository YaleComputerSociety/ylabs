/**
 * The texts one evidence value carries. A page-text lane stores its passages as a list,
 * one writer snippet each, because a latest-wins field keeps one live value per row.
 */
export function evidenceValueTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
