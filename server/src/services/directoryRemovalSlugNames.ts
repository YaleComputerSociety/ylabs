import { SLUG_MAX_LENGTH, slugTokens } from '../scrapers/utils/scraperHelpers';

const UNDISTINCTIVE_SLUG_TOKENS = new Set([
  'a',
  'and',
  'area',
  'center',
  'centre',
  'faculty',
  'for',
  'group',
  'in',
  'initiative',
  'institute',
  'lab',
  'laboratory',
  'labs',
  'of',
  'program',
  'project',
  'research',
  'studio',
  'team',
  'the',
]);

const personNameTokens = (name: unknown): string[] =>
  typeof name === 'string' ? slugTokens(name) : [];

function indexOfRun(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return start;
  }
  return -1;
}

function fullNamePositions(slugTokenList: readonly string[], name: unknown): number[] {
  const tokens = personNameTokens(name);
  if (tokens.length < 2) return [];
  const givenAndSurname = [tokens[0], tokens[tokens.length - 1]];
  for (const run of [tokens, givenAndSurname]) {
    const start = indexOfRun(slugTokenList, run);
    if (start >= 0) return run.map((_, offset) => start + offset);
  }
  return [];
}

export function slugNamesPersonByFullName(slug: unknown, name: unknown): boolean {
  if (typeof slug !== 'string') return false;
  return fullNamePositions(slugTokens(slug), name).length > 0;
}

function surnameOnlyPositions(
  slugTokenList: readonly string[],
  removedTokens: readonly string[],
  remainingLeadTokens: ReadonlyArray<readonly string[]>,
): number[] {
  if (removedTokens.length < 2) return [];
  const given = removedTokens[0];
  const surname = removedTokens[removedTokens.length - 1];
  if (slugTokenList.includes(given)) return [];
  if (remainingLeadTokens.some((tokens) => tokens.includes(surname))) return [];
  return slugTokenList.flatMap((token, index) => (token === surname ? [index] : []));
}

function boundedSlug(tokens: readonly string[]): string {
  return tokens.join('-').slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
}

/**
 * The slug a co-led row takes once one of its leads is removed from the directory (#4160):
 * the row's own tokens with the removed lead's name taken out, keeping the lane prefix in
 * place. A surname alone is taken out only when it is not also a remaining lead's name, and
 * when what is left says nothing distinctive the remaining leads' surnames stand in.
 */
export function slugWithoutRemovedLead(args: {
  slug: string;
  removedLeadName: unknown;
  remainingLeadNames: readonly unknown[];
}): string | undefined {
  const tokens = args.slug.split('-').filter(Boolean);
  const removedTokens = personNameTokens(args.removedLeadName);
  const remainingLeadTokens = args.remainingLeadNames
    .map(personNameTokens)
    .filter((nameTokens) => nameTokens.length > 0);
  if (remainingLeadTokens.length === 0) return undefined;

  const fullName = fullNamePositions(tokens, args.removedLeadName);
  const stripped = new Set(
    fullName.length > 0
      ? fullName
      : surnameOnlyPositions(tokens, removedTokens, remainingLeadTokens),
  );
  if (stripped.size === 0) return undefined;

  const firstStripped = Math.min(...stripped);
  const kept = tokens.flatMap((token, index) => (stripped.has(index) ? [] : [{ token, index }]));
  const remainingTokens = new Set(remainingLeadTokens.flat());
  const distinctive = kept.some(
    ({ token, index }) =>
      !UNDISTINCTIVE_SLUG_TOKENS.has(token) &&
      (index > firstStripped || remainingTokens.has(token)),
  );
  const remainingSurnames = [
    ...new Set(remainingLeadTokens.map((nameTokens) => nameTokens[nameTokens.length - 1])),
  ];
  const nextTokens = distinctive
    ? kept.map(({ token }) => token)
    : [
        ...kept.filter(({ index }) => index < firstStripped).map(({ token }) => token),
        ...remainingSurnames,
        ...kept.filter(({ index }) => index > firstStripped).map(({ token }) => token),
      ];
  const next = boundedSlug(nextTokens);
  return next && next !== args.slug ? next : undefined;
}

export function numberedSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
}
