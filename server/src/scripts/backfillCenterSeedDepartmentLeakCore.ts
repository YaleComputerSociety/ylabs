/**
 * Pure helpers for the center-seed department/researchArea leak backfill.
 *
 * A legacy `centers-institutes-index` scraper run seeded each institute's
 * spanning `departments` (e.g. Wu Tsai Institute's Neuroscience / Psychology /
 * MCDB) onto every member's own `faculty-research-area-*` entity, and those
 * values later unioned into merged survivors' `departments`/`researchAreas`.
 * The current scraper no longer emits member departments, so this is residue.
 *
 * Cleaning rule: a seeded value is stripped from a member entity ONLY when it
 * is NOT independently corroborated by that member's own (non-center) field
 * observations. A genuine Neuroscience-department member keeps "Neuroscience";
 * a Computer Science or Philosophy member has it removed. This fails closed -
 * it never drops a value the member's own source actually asserts.
 */

export function normalizeDeptToken(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Expand a center's declared `departments` seed into the concrete string forms
 * that leaked onto members. The MCDB seed also leaked as the shortened
 * "Developmental Biology" research-area chip.
 */
export function expandLeakedSeedForms(seeds: string[]): string[] {
  const forms = new Set<string>();
  for (const seed of seeds) {
    const trimmed = String(seed).trim();
    if (!trimmed) continue;
    forms.add(trimmed);
    if (/developmental biology$/i.test(trimmed)) forms.add('Developmental Biology');
  }
  return [...forms];
}

export interface StripUncorroboratedLeakInput {
  current: string[];
  ownObserved: string[];
  leaked: string[];
}

export interface StripUncorroboratedLeakResult {
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

export function stripUncorroboratedLeak(
  input: StripUncorroboratedLeakInput,
): StripUncorroboratedLeakResult {
  const leakedSet = new Set(input.leaked.map(normalizeDeptToken));
  const ownSet = new Set(input.ownObserved.map(normalizeDeptToken));
  const removed: string[] = [];
  const cleaned = input.current.filter((value) => {
    const token = normalizeDeptToken(value);
    const isUncorroboratedLeak = leakedSet.has(token) && !ownSet.has(token);
    if (isUncorroboratedLeak) removed.push(value);
    return !isUncorroboratedLeak;
  });
  return { cleaned, removed, changed: removed.length > 0 };
}
