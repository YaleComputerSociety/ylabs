import type { GoldLabel } from './laneScorecardCore';

export interface GoldLabelValidationScope {
  only: readonly string[];
}

/**
 * Checks a hand-judged label file before it is attached to a benchmark (#3588). A label
 * outside the benchmark's scope could never be scored, and a `present` label with nothing
 * acceptable would count every emission wrong, so both are refused rather than stored.
 */
export function parseGoldLabelFile(raw: unknown, scope: GoldLabelValidationScope): GoldLabel[] {
  if (!Array.isArray(raw)) throw new Error('a gold label file is a JSON array of labels');
  const inScope = new Set(scope.only);
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const at = `label ${index}`;
    if (!entry || typeof entry !== 'object') throw new Error(`${at} is not an object`);
    const label = entry as Record<string, unknown>;
    const entityKey = typeof label.entityKey === 'string' ? label.entityKey.trim() : '';
    const field = typeof label.field === 'string' ? label.field.trim() : '';
    if (!entityKey || !field) throw new Error(`${at} needs an entityKey and a field`);
    if (inScope.size > 0 && !inScope.has(entityKey)) {
      throw new Error(`${at} names an entity outside the benchmark's scope`);
    }
    if (label.expected !== 'present' && label.expected !== 'absent') {
      throw new Error(`${at} expected must be "present" or "absent"`);
    }
    const acceptable = Array.isArray(label.acceptable)
      ? label.acceptable.filter(
          (value): value is string => typeof value === 'string' && !!value.trim(),
        )
      : [];
    if (label.expected === 'present' && acceptable.length === 0) {
      throw new Error(`${at} is present but lists no acceptable value`);
    }
    if (label.expected === 'absent' && acceptable.length > 0) {
      throw new Error(`${at} is absent but lists acceptable values`);
    }
    const pair = `${entityKey}\u0000${field}`;
    if (seen.has(pair)) throw new Error(`${at} repeats an (entityKey, field) pair`);
    seen.add(pair);
    return {
      entityKey,
      field,
      expected: label.expected,
      acceptable,
      ...(typeof label.judgedPageUrl === 'string' ? { judgedPageUrl: label.judgedPageUrl } : {}),
      ...(typeof label.note === 'string' ? { note: label.note } : {}),
    };
  });
}
