import type { SearchSpellingVocabulary } from './searchQuerySpellingCorrection';

// A fixed, hand-curated list of common English given-name short forms, accepted by the
// owner for person-name queries only (#5169, decision of 2026-11-11). It is deliberately
// small and English-only, and it is never applied to a topic query: see
// `resolveNicknameInNameQuery` for the predicate that keeps "art", "will" or "bill" a topic.
export const GIVEN_NAME_SHORT_FORMS: Readonly<Record<string, readonly string[]>> = {
  abby: ['abigail'],
  alex: ['alexander', 'alexandra'],
  andy: ['andrew'],
  art: ['arthur'],
  becky: ['rebecca'],
  ben: ['benjamin'],
  beth: ['elizabeth'],
  betsy: ['elizabeth'],
  betty: ['elizabeth'],
  bill: ['william'],
  billy: ['william'],
  bob: ['robert'],
  bobby: ['robert'],
  cathy: ['catherine'],
  charlie: ['charles'],
  chris: ['christopher', 'christine', 'christina', 'christian'],
  chuck: ['charles'],
  cindy: ['cynthia'],
  dan: ['daniel'],
  danny: ['daniel'],
  dave: ['david'],
  deb: ['deborah'],
  debbie: ['deborah'],
  doug: ['douglas'],
  drew: ['andrew'],
  ed: ['edward'],
  eddie: ['edward'],
  ellie: ['eleanor'],
  fran: ['frances', 'francis'],
  fred: ['frederick'],
  gabe: ['gabriel'],
  geoff: ['geoffrey'],
  greg: ['gregory'],
  hank: ['henry'],
  herb: ['herbert'],
  jeff: ['jeffrey'],
  jen: ['jennifer'],
  jenny: ['jennifer'],
  jerry: ['gerald'],
  jess: ['jessica'],
  jim: ['james'],
  jimmy: ['james'],
  joe: ['joseph'],
  joey: ['joseph'],
  jon: ['jonathan'],
  josh: ['joshua'],
  kate: ['katherine', 'catherine'],
  kathy: ['katherine', 'kathleen'],
  katie: ['katherine', 'catherine'],
  ken: ['kenneth'],
  larry: ['lawrence'],
  liz: ['elizabeth'],
  lizzie: ['elizabeth'],
  lou: ['louis'],
  mandy: ['amanda'],
  matt: ['matthew'],
  meg: ['margaret'],
  maggie: ['margaret'],
  mike: ['michael'],
  mitch: ['mitchell'],
  nate: ['nathan', 'nathaniel'],
  nick: ['nicholas'],
  nikki: ['nicole'],
  pam: ['pamela'],
  pat: ['patrick', 'patricia'],
  peggy: ['margaret'],
  pete: ['peter'],
  phil: ['philip', 'phillip'],
  ray: ['raymond'],
  rich: ['richard'],
  rick: ['richard'],
  rob: ['robert'],
  robbie: ['robert'],
  ron: ['ronald'],
  russ: ['russell'],
  sam: ['samuel', 'samantha'],
  sandy: ['sandra'],
  stan: ['stanley'],
  steph: ['stephanie'],
  steve: ['steven', 'stephen'],
  sue: ['susan', 'suzanne'],
  ted: ['edward', 'theodore'],
  tim: ['timothy'],
  tom: ['thomas'],
  tommy: ['thomas'],
  tony: ['anthony'],
  vicky: ['victoria'],
  vince: ['vincent'],
  walt: ['walter'],
  will: ['william'],
  zach: ['zachary'],
};

const MAX_NAME_QUERY_TOKENS = 3;

export interface NicknameExpansion {
  nickname: string;
  givenName: string;
}

type PersonNameLookup = Pick<SearchSpellingVocabulary, 'personNamesByWord'>;

const personNamesCarrying = (
  vocabulary: PersonNameLookup,
  givenName: string,
  otherTokens: readonly string[],
): number =>
  (vocabulary.personNamesByWord.get(givenName) ?? []).filter((nameWords) =>
    otherTokens.every((token) => nameWords.has(token)),
  ).length;

// Requiring one served person to carry the full given name beside every other query word
// is the topic guard: "art history" and "will power" name no such person even when each
// word is some person's name word. A short form a person's name carries as typed is left
// to the keyword legs, which already reach that person.
export const resolveNicknameInNameQuery = (
  tokens: readonly string[],
  vocabulary: PersonNameLookup | null,
): NicknameExpansion | null => {
  if (!vocabulary || tokens.length < 2 || tokens.length > MAX_NAME_QUERY_TOKENS) return null;
  const [nickname, ...otherTokens] = tokens;
  const givenNames = GIVEN_NAME_SHORT_FORMS[nickname];
  if (!givenNames) return null;
  if (personNamesCarrying(vocabulary, nickname, otherTokens) > 0) return null;
  let best: { givenName: string; people: number } | null = null;
  for (const givenName of givenNames) {
    const people = personNamesCarrying(vocabulary, givenName, otherTokens);
    if (people > 0 && (!best || people > best.people)) best = { givenName, people };
  }
  return best ? { nickname, givenName: best.givenName } : null;
};

export const replaceNicknameInQuery = (query: string, expansion: NicknameExpansion): string =>
  query.replace(new RegExp(`\\b${expansion.nickname}\\b`, 'i'), expansion.givenName);
