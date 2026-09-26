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
/**
 * A degree qualifier is not always present: the corpus stores bare "Student",
 * "MA Student", "IDE Student" and "Graduate School Student", none of which the
 * qualifier alternatives above reach. An alumnus of a programme is read the same
 * way, because the programme affiliation is the whole of the appointment (#2836).
 *
 * Two anchors keep the widening safe, and both were measured against a row this
 * rule would otherwise have taken off the served surface. The noun must END its
 * clause, which separates a rank ("IDE Student") from a modifier ("International
 * Student Adviser"). And it must fall in the title's opening words, because an
 * appointment names its rank there while prose does not: one served lab's only PI
 * stores a paper title in the field, and "...a guide for students and faculty"
 * satisfies the clause rule on its own.
 */
const TRAINEE_HEAD_NOUN_PATTERN =
  /^(?:\S+\s+){0,3}(students?|alumn(?:us|a|i|ae))\s*(?:$|[,;&()/]|\band\b)/i;
const SUPERVISORY_TITLE_PATTERN = /\b(professor|lecturer|director|dean|chair)\b/i;
const SOFT_HYPHEN_PATTERN = /­/g;

export const isTraineeLevelTitle = (title?: string): boolean => {
  const normalized = (title || '').replace(SOFT_HYPHEN_PATTERN, '').trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  return TRAINEE_TITLE_PATTERN.test(normalized) || TRAINEE_HEAD_NOUN_PATTERN.test(normalized);
};
