import {
  givenNamesAgree,
  givenNamesEquivalent,
  statedMiddleInitialsConflict,
  surnamesCompatible,
} from './piNameMatch';
import { normalizeName, splitName } from './scraperHelpers';

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const soleNameToken = (name: string): string => {
  const tokens = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.length === 1 ? tokens[0] : '';
};

/**
 * The email join and the inferred-director profile-URL join have no name resolver
 * behind them, so they carry their own name check: the observed name must agree on
 * surname and given name with the researcher that key already backs. Reuses the same
 * comparators as `resolveResearcherIdForPersonName` so every lane agrees on what
 * "same person" means. A person known by a single name has no surname to compare, so
 * two single-token names agree only when they are the same name.
 */
export function observedPersonNameAgreesWith(
  storedDisplayName: unknown,
  observedDisplayName: string,
): boolean {
  const storedMononym = soleNameToken(textOf(storedDisplayName));
  if (storedMononym && storedMononym === soleNameToken(textOf(observedDisplayName))) return true;
  const stored = splitName(textOf(storedDisplayName));
  const observed = splitName(observedDisplayName);
  if (!stored.last || !observed.last) return false;
  if (!surnamesCompatible(observed.last, stored.last)) return false;
  if (!stored.first || !observed.first) return false;
  return (
    stored.first.toLowerCase() === observed.first.toLowerCase() ||
    givenNamesEquivalent(observed.first, stored.first)
  );
}

const GENERATIONAL_SUFFIX_TOKENS = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const foldedNameTokens = (name: unknown): string[] =>
  normalizeName(textOf(name))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !GENERATIONAL_SUFFIX_TOKENS.has(token));

const sameTokensInAnyOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && [...left].sort().join(' ') === [...right].sort().join(' ');

function joinedSurnameRun(tokens: readonly string[], otherSurname: string): number {
  for (let run = 2; run < tokens.length; run += 1) {
    if (tokens.slice(-run).join('') === otherSurname) return run;
  }
  return 0;
}

function sharedSurnameRuns(
  left: readonly string[],
  right: readonly string[],
): [number, number] | null {
  const leftSurname = left[left.length - 1];
  const rightSurname = right[right.length - 1];
  if (surnamesCompatible(leftSurname, rightSurname)) return [1, 1];
  const leftRun = joinedSurnameRun(left, rightSurname);
  if (leftRun) return [leftRun, 1];
  const rightRun = joinedSurnameRun(right, leftSurname);
  return rightRun ? [1, rightRun] : null;
}

function givenNamesOfOnePerson(left: readonly string[], right: readonly string[]): boolean {
  const [leftFirst, rightFirst] = [left[0], right[0]];
  if (!leftFirst || !rightFirst) return false;
  if (statedMiddleInitialsConflict(left.join(' '), right.join(' '))) return false;
  const initialOf = (initial: string, given: string) =>
    initial.length === 1 && given[0] === initial;
  if (initialOf(leftFirst, rightFirst) || initialOf(rightFirst, leftFirst)) return true;
  const leftWhole = left.filter((token) => token.length > 1);
  const rightWhole = right.filter((token) => token.length > 1);
  if (leftWhole.some((x) => rightWhole.some((y) => x === y || givenNamesAgree(x, y)))) return true;
  const leftJoined = left.join('');
  const rightJoined = right.join('');
  return leftJoined === rightJoined || leftJoined === rightFirst || rightJoined === leftFirst;
}

export function personNamesShareASurname(left: unknown, right: unknown): boolean {
  const leftTokens = foldedNameTokens(left);
  const rightTokens = foldedNameTokens(right);
  return (
    leftTokens.length >= 2 &&
    rightTokens.length >= 2 &&
    Boolean(sharedSurnameRuns(leftTokens, rightTokens))
  );
}

/**
 * Whether a listed person is the person a row is named after, strictly enough to let a
 * merge redirect carry that listing's evidence onto the row (#5771).
 *
 * Wider than `observedPersonNameAgreesWith` by an initial, a shared given or middle name,
 * a joined spelling and a reordered one, and narrower than `givenNamesCouldNameOnePerson`
 * by having no prefix arm: a complete short given name is a prefix of an unrelated longer
 * one, which is how the removed prefix rule (#5324) merged two same-surname people.
 */
export function listedPersonIsTheNamedLead(listedName: unknown, namedLeadName: unknown): boolean {
  const listed = textOf(listedName);
  if (!listed) return false;
  if (observedPersonNameAgreesWith(namedLeadName, listed)) return true;
  const left = foldedNameTokens(listed);
  const right = foldedNameTokens(namedLeadName);
  if (left.length < 2 || right.length < 2) return false;
  if (sameTokensInAnyOrder(left, right) || left.join('') === right.join('')) return true;
  const surnameRuns = sharedSurnameRuns(left, right);
  if (!surnameRuns) return false;
  return givenNamesOfOnePerson(left.slice(0, -surnameRuns[0]), right.slice(0, -surnameRuns[1]));
}

const leadingGivenToken = (given: string): string => given.split(/\s+/)[0] ?? '';

export function namesStateConflictingMiddleInitials(left: unknown, right: unknown): boolean {
  const a = splitName(textOf(left));
  const b = splitName(textOf(right));
  if (!a.first || !a.last || !b.first || !b.last) return false;
  if (!surnamesCompatible(a.last, b.last)) return false;
  if (!statedMiddleInitialsConflict(a.first, b.first)) return false;
  const [firstA, firstB] = [leadingGivenToken(a.first), leadingGivenToken(b.first)];
  return firstA.toLowerCase() === firstB.toLowerCase() || givenNamesEquivalent(firstA, firstB);
}

export function anyNamesStateConflictingMiddleInitials(
  lefts: readonly unknown[],
  rights: readonly unknown[],
): boolean {
  return lefts.some((left) =>
    rights.some((right) => namesStateConflictingMiddleInitials(left, right)),
  );
}

export function groupNamesStateConflictingMiddleInitials(names: readonly unknown[]): boolean {
  return names.some((left, index) =>
    names.slice(index + 1).some((right) => namesStateConflictingMiddleInitials(left, right)),
  );
}
