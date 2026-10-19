import {
  isLikelyPersonSpecificYaleEmail,
  isRoleOrUnitMailbox,
  yaleUnitMailboxTokens,
} from './utils/scraperHelpers';

type KeyedObservation = {
  field?: string;
  value?: unknown;
  sourceUrl?: string | null;
};

const NETID_USER_KEY_PATTERN = /^netid:([a-z0-9._-]+)$/i;

function mailboxForUserKey(entityKey: string | undefined | null): string | null {
  const match = String(entityKey || '')
    .trim()
    .match(NETID_USER_KEY_PATTERN);
  return match ? `${match[1].toLowerCase()}@yale.edu` : null;
}

function observedPersonNames(observations: readonly KeyedObservation[]): string[] {
  const textOf = (field: string): string[] =>
    observations
      .filter((o) => o.field === field && typeof o.value === 'string' && o.value.trim())
      .map((o) => String(o.value).trim());
  const firstNames = textOf('fname');
  const lastNames = textOf('lname');
  const pairs = firstNames.flatMap((first) => lastNames.map((last) => `${first} ${last}`));
  return [...pairs, ...textOf('displayName')];
}

/**
 * Whether a `netid:<local>` user key was minted from an office mailbox rather than a
 * person's address. Rosters read before the person-email guard took the contact address
 * printed on a faculty profile (`<unit>@yale.edu`, `<unit>.dus@yale.edu`) as the faculty
 * member's own, and keyed the person by it. Observations are immutable and the lane now
 * keys that person elsewhere, so the stale key is screened on every read instead.
 *
 * A role word decides alone. A unit-name local part decides only when the key's own
 * pages are that unit's and the address also fails to name the person the key observes,
 * so a person whose surname happens to equal a site label keeps their key.
 */
export function userKeyNamesRoleOrUnitMailbox(
  entityKey: string | undefined | null,
  observations: readonly KeyedObservation[],
): boolean {
  const mailbox = mailboxForUserKey(entityKey);
  if (!mailbox) return false;
  if (isRoleOrUnitMailbox(mailbox)) return true;
  const unitTokens = yaleUnitMailboxTokens(observations.map((o) => o.sourceUrl));
  if (!isRoleOrUnitMailbox(mailbox, unitTokens)) return false;
  return !observedPersonNames(observations).some((name) =>
    isLikelyPersonSpecificYaleEmail(mailbox, name),
  );
}

/**
 * Whether an `inferredPiUserKey` observation names such a key. The research row's own
 * observation carries the roster page it was read from, which is the unit evidence.
 */
export function inferredPiKeyNamesRoleOrUnitMailbox(
  userEntityKey: string,
  observation: KeyedObservation,
): boolean {
  const mailbox = mailboxForUserKey(userEntityKey);
  if (!mailbox) return false;
  return isRoleOrUnitMailbox(mailbox, yaleUnitMailboxTokens([observation.sourceUrl]));
}
