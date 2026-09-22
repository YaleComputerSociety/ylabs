/**
 * Whether a title names someone who cannot host a student on their own.
 *
 * A postdoc runs real research but has no standing to admit an undergraduate: a
 * student approaches the PI, who pairs them with a postdoc. So a row whose only
 * lead holds such a title does not describe an access route (#2876). The same is
 * true a fortiori of a PhD student, a masters student or an intern.
 *
 * A supervisory title alongside the trainee one exempts the person, because a
 * professor or lecturer can supervise whatever else their title says.
 *
 * Duplicated from `client/src/utils/leadRoleDisplay.ts` because client and server
 * are separate packages; parity is pinned by behaviour in a test, per #2433.
 */
const TRAINEE_TITLE_PATTERN =
  /\b(post-?doctoral|post-?doc|research assistant|(?:ph\.?\s?d|doctoral|graduate|undergraduate|masters?|m\.?s)\.?\s+(?:student|candidate)|intern|pre-?doctoral|trainee)\b/i;
const SUPERVISORY_TITLE_PATTERN = /\b(professor|lecturer|director|dean|chair)\b/i;

export const isTraineeLevelTitle = (title?: string): boolean => {
  const normalized = (title || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  return TRAINEE_TITLE_PATTERN.test(normalized);
};
