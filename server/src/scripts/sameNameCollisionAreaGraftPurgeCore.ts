/**
 * Pure planning helpers for the #585 same-name-collision graft purge (#1256).
 *
 * #585 fixed the officialProfilePiBackfillScraper at write time so a same-name
 * medical/veterinary profile can no longer graft its research interests and
 * website onto an unrelated humanities/social-science entity. But the records
 * minted before that gate still carry the grafted values, and #585's closing
 * note called for a backfill that was never run.
 *
 * These grafted `researchAreas` are unbacked direct-writes: there is no owning
 * observation to self-scope from (unlike the #1055 center-seed leak), and a
 * broad "medical-shaped area on a non-medical entity" regex over-purges genuine
 * interdisciplinary scholars (a medical anthropologist's "Women's health", a
 * health economist's "Health Care Economics", a genomic epidemiologist's
 * "Infectious Diseases"). So removal is scoped to an individually verified set
 * of exact graft strings, and only strings still present are removed. This
 * fails closed: it never drops a value not on the verified graft list.
 */

export function normalizeGraftToken(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AreaGraftRemovalInput {
  current: string[];
  removeAreas: string[];
}

export interface AreaGraftRemovalResult {
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

export function planAreaGraftRemoval(input: AreaGraftRemovalInput): AreaGraftRemovalResult {
  const removeSet = new Set(input.removeAreas.map(normalizeGraftToken));
  const removed: string[] = [];
  const cleaned = input.current.filter((value) => {
    const isGraft = removeSet.has(normalizeGraftToken(value));
    if (isGraft) removed.push(value);
    return !isGraft;
  });
  return { cleaned, removed, changed: removed.length > 0 };
}

export interface WebsiteClearInput {
  current: string | undefined | null;
  clearIfEquals: string;
}

export interface WebsiteClearResult {
  cleared: boolean;
  from: string;
}

export function planWebsiteClear(input: WebsiteClearInput): WebsiteClearResult {
  const from = String(input.current || '');
  const cleared = normalizeGraftToken(from) === normalizeGraftToken(input.clearIfEquals);
  return { cleared, from };
}
