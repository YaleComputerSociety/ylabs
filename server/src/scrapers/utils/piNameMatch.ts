/**
 * Pure name-matching helpers for resolving a grant PI name to a Yale faculty User.
 *
 * SAFETY: these widen recall (nickname/formal-name variants, particle and compound
 * surnames) but never decide a match alone. Every caller still requires a single
 * unambiguous candidate and fails closed to a shell otherwise, so a broadened
 * surname or nickname that pulls in two distinct people never mis-links. The
 * nickname map omits genuinely ambiguous pairs so a broadened match is unambiguous.
 */

const SURNAME_PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'dela',
  'della',
  'di',
  'da',
  'das',
  'dos',
  'du',
  'der',
  'den',
  'la',
  'le',
  'lo',
  'el',
  'al',
  'bin',
  'ibn',
  'ter',
  'ten',
  'vander',
  'af',
  'av',
  'zu',
  'zur',
  'saint',
  'st',
]);

const NICKNAME_GROUPS: string[][] = [
  ['robert', 'rob', 'robbie', 'bob', 'bobby'],
  ['william', 'will', 'bill', 'billy', 'willie'],
  ['richard', 'rich', 'rick', 'ricky', 'dick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jon', 'jack', 'johnny'],
  ['jonathan', 'jon', 'jonny'],
  ['joseph', 'joe', 'joey'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['charles', 'charlie', 'chuck'],
  ['thomas', 'tom', 'tommy'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['theodore', 'ted', 'teddy', 'theo'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['matthew', 'matt', 'matty'],
  ['anthony', 'tony'],
  ['christopher', 'chris'],
  ['nicholas', 'nick', 'nicky'],
  ['benjamin', 'ben', 'benji'],
  ['samuel', 'sam', 'sammy'],
  ['alexander', 'alex', 'xander', 'sasha'],
  ['andrew', 'andy', 'drew'],
  ['stephen', 'steve', 'steven'],
  ['steven', 'steve'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['gregory', 'greg'],
  ['frederick', 'fred', 'freddie'],
  ['raymond', 'ray'],
  ['eugene', 'gene'],
  ['lawrence', 'larry'],
  ['gerald', 'gerry', 'jerry'],
  ['elizabeth', 'liz', 'beth', 'betty', 'eliza', 'betsy'],
  ['katherine', 'kate', 'katie', 'kathy', 'katy'],
  ['catherine', 'cathy', 'cath', 'katie'],
  ['margaret', 'maggie', 'meg', 'peggy', 'marge'],
  ['jennifer', 'jen', 'jenn', 'jenny'],
  ['candace', 'candice', 'candie', 'candy'],
  ['deborah', 'deb', 'debbie'],
  ['susan', 'sue', 'susie'],
  ['rebecca', 'becky', 'becca'],
  ['kimberly', 'kim'],
  ['cynthia', 'cindy'],
  ['patricia', 'patty', 'tricia', 'trish'],
  ['victoria', 'vicky', 'tori'],
  ['pamela', 'pam'],
];

const VARIANT_INDEX = ((): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const group of NICKNAME_GROUPS) {
    for (const name of group) {
      let set = index.get(name);
      if (!set) {
        set = new Set<string>();
        index.set(name, set);
      }
      for (const other of group) set.add(other);
    }
  }
  return index;
})();

function foldToken(token: string | undefined | null): string {
  return String(token || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function givenTokens(name: string | undefined | null): string[] {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function givenNamesEquivalent(a: string, b: string): boolean {
  const fa = givenTokens(a)[0] || '';
  const fb = givenTokens(b)[0] || '';
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const variants = VARIANT_INDEX.get(fa);
  return variants ? variants.has(fb) : false;
}

export function givenNameVariants(first: string): string[] {
  const key = foldToken(first);
  if (!key) return [];
  const out = new Set<string>([key]);
  const variants = VARIANT_INDEX.get(key);
  if (variants) for (const v of variants) out.add(v);
  return [...out];
}

function surnameTokens(surname: string | undefined | null): string[] {
  return String(surname || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-'\u2018\u2019]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function stripLeadingParticles(tokens: string[]): { particles: string[]; core: string[] } {
  let i = 0;
  while (i < tokens.length - 1 && SURNAME_PARTICLES.has(tokens[i])) i += 1;
  return { particles: tokens.slice(0, i), core: tokens.slice(i) };
}

function isSuffix(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  const offset = longer.length - shorter.length;
  return shorter.every((token, i) => token === longer[offset + i]);
}

export function surnameCoreKey(surname: string | undefined | null): string {
  const { core } = stripLeadingParticles(surnameTokens(surname));
  return core.at(-1) || '';
}

export const SURNAME_FETCH_LIMIT = 200;

export function surnameFetchRegex(surname: string | undefined | null): RegExp | null {
  const key = surnameCoreKey(surname);
  if (!key) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s-])${escaped}$`, 'i');
}

export function surnamesCompatible(
  sourceSurname: string | undefined | null,
  candidateSurname: string | undefined | null,
): boolean {
  const source = surnameTokens(sourceSurname);
  const candidate = surnameTokens(candidateSurname);
  if (source.length === 0 || candidate.length === 0) return false;
  if (source.join(' ') === candidate.join(' ')) return true;

  const { particles: sourceParticles, core: sourceCore } = stripLeadingParticles(source);
  const { particles: candidateParticles, core: candidateCore } = stripLeadingParticles(candidate);
  if (sourceCore.length === 0 || candidateCore.length === 0) return false;

  if (sourceCore.join(' ') === candidateCore.join(' ')) {
    if (sourceParticles.join(' ') === candidateParticles.join(' ')) return true;
    return sourceParticles.length === 0 || candidateParticles.length === 0;
  }

  return isSuffix(sourceCore, candidateCore) || isSuffix(candidateCore, sourceCore);
}

export type SurnameOnlyMatch = 'ambiguous' | 'absent';

/**
 * The give-up rule for a PI name that carries no usable given name (a lab named
 * only after a surname, e.g. "Berg Lab"). A surname alone can NEVER attach a PI:
 * even a lone surname-compatible faculty candidate might be a namesake rather
 * than the real lead (issue #562, "Schwartz Lab" attaching Michael Schwartz when
 * the real PI is Martin Schwartz). Resolution requires agreement on more than the
 * surname, so this always fails closed - 'ambiguous' when any candidate carries
 * the surname, 'absent' when none does. Callers never treat either as a match.
 */
export function surnameOnlyMatch(surnameCompatibleCandidateCount: number): SurnameOnlyMatch {
  return surnameCompatibleCandidateCount > 0 ? 'ambiguous' : 'absent';
}
