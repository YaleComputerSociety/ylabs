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
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
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

export interface GraftGrant {
  id?: string;
  agency?: string;
  [key: string]: unknown;
}

export interface GrantGraftRemovalInput {
  current: GraftGrant[];
  removeGrantIds: string[];
}

export interface GrantGraftRemovalResult {
  cleaned: GraftGrant[];
  removed: GraftGrant[];
  fundingAgencies: string[];
  changed: boolean;
}

/**
 * Removes grants belonging to a different, same-surname PI from a `recentGrants`
 * array (issue #1290: an NIH grant-shell backfill can attach a same-surname
 * PI's grants to the wrong lab entity) and recomputes `fundingAgencies` from
 * what remains, matching the removal-by-exact-id scoping used elsewhere in
 * this module.
 */
export function planGrantGraftRemoval(input: GrantGraftRemovalInput): GrantGraftRemovalResult {
  const removeSet = new Set(input.removeGrantIds.map(normalizeGraftToken));
  const removed: GraftGrant[] = [];
  const cleaned = input.current.filter((grant) => {
    const isGraft = removeSet.has(normalizeGraftToken(String(grant.id || '')));
    if (isGraft) removed.push(grant);
    return !isGraft;
  });
  const fundingAgencies = Array.from(
    new Set(cleaned.map((grant) => String(grant.agency || '')).filter(Boolean)),
  );
  return { cleaned, removed, fundingAgencies, changed: removed.length > 0 };
}

export interface PoisonedDescriptionInput {
  description: string | undefined | null;
  graftedAreas: readonly string[];
}

/**
 * Whether a stored description still echoes the grafted areas the spec is removing.
 * Read for both the card and the body: a fabricated research statement and the chips
 * that restate it are one defect, so clearing one without the other leaves the served
 * row asserting the graft in the field that was left (#1407).
 *
 * `clearPoisonedShortDescription` was an unconditional instruction, and its premise
 * expires: one entry's row has since acquired a correct, source-backed short
 * description about American political institutions while the spec still said to
 * blank it, so a re-run of this lane would have emptied a served card. A repair whose
 * premise can expire has to re-read the premise, so the clear now fires only when the
 * stored text shares a distinctive word with an area being removed.
 */
export function descriptionEchoesGraftedAreas(input: PoisonedDescriptionInput): boolean {
  const short = normalizeGraftToken(String(input.description || ''));
  if (!short) return false;
  const stopWords = new Set([
    'and',
    'the',
    'of',
    'in',
    'for',
    'with',
    'research',
    'studies',
    'study',
    'care',
    'health',
    'management',
    'treatment',
    'outcomes',
    'function',
    'effects',
    'science',
    'sciences',
    'analysis',
    'practices',
    'practice',
    'policy',
    'primary',
    'clinical',
    'implementation',
  ]);
  const shortWords = new Set(short.split(/[^a-z0-9]+/).filter(Boolean));
  // One shared word is not an echo. The card that made this guard necessary shares
  // "dynamics" with "Protein Structure and Dynamics" and is about institutional
  // dynamics, so an echo needs two of an area's distinctive words, or the only one it
  // has when the area names a single topic.
  return input.graftedAreas.some((area) => {
    const distinctive = normalizeGraftToken(area)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !stopWords.has(word));
    if (distinctive.length === 0) return false;
    const shared = new Set(distinctive.filter((word) => shortWords.has(word)));
    return shared.size >= Math.min(2, new Set(distinctive).size);
  });
}

export interface PoisonedDescriptionClearInput {
  requested: boolean | undefined;
  current: string | undefined | null;
  graftedAreas: readonly string[];
}

export interface PoisonedDescriptionClearResult {
  cleared: boolean;
  from: string;
}

/**
 * One planner for both description clears, so the card and the body cannot drift apart
 * on which premise they re-read. A clear fires only when the spec asks for it, the
 * stored text is non-empty, and that text still echoes an area this run is removing.
 */
export function planPoisonedDescriptionClear(
  input: PoisonedDescriptionClearInput,
): PoisonedDescriptionClearResult {
  const from = String(input.current || '');
  if (!input.requested || !from) return { cleared: false, from };
  return {
    cleared: descriptionEchoesGraftedAreas({
      description: from,
      graftedAreas: input.graftedAreas,
    }),
    from,
  };
}
