import type { StudentVisibilityTier } from '../models/studentVisibility';
import { YALE_FELLOWSHIP_DATABASE_SOURCE } from '../scrapers/fellowshipSourcePrecedence';
import { recordSpecificApplicationPortalIdentity } from '../utils/researchHomeWebsiteUrl';

export interface ProgramDuplicateCandidate {
  id: string;
  title?: string;
  description?: string;
  sourceName?: string;
  sourceUrl?: string;
  applicationLink?: string;
  links?: ReadonlyArray<{ url?: string } | null | undefined>;
  tier: StudentVisibilityTier | string | undefined;
}

// A CommunityForce fund page is reached through an encrypted query that differs from link
// to link, so one fund carries several FundDetails URLs and a differing URL never tells two
// funds apart (#3988). Neither the title nor the description can identify a fund alone: distinct funds
// share titles, and each residential college's copy of a fund shares one description word
// for word, differing only in the college its title names. The two together can.
const MIN_IDENTIFYING_DESCRIPTION_LENGTH = 80;
const PHRASE_LENGTH = 5;
const MIN_IDENTIFYING_PHRASES = 12;
const MIN_SHARED_PHRASE_RATIO = 0.8;

const normalizedText = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function programFundTitleKey(title: unknown): string {
  return normalizedText(
    String(title || '')
      .replace(/&/g, ' and ')
      .replace(/['’]/g, ''),
  ).replace(/^the /, '');
}

function descriptionPhrases(description: string): Set<string> {
  const words = description.split(' ').filter(Boolean);
  const phrases = new Set<string>();
  for (let index = 0; index + PHRASE_LENGTH <= words.length; index += 1) {
    phrases.add(words.slice(index, index + PHRASE_LENGTH).join(' '));
  }
  return phrases;
}

interface FundDescription {
  text: string;
  phrases: Set<string>;
}

const fundDescription = (value: unknown): FundDescription => {
  const text = normalizedText(value);
  return { text, phrases: descriptionPhrases(text) };
};

// One lane stores the fund's own paragraph and another the page around it, so the same fund
// is recognised when the shorter description is the longer one, or nearly all of its
// phrases recur there.
function sameFundDescription(a: FundDescription, b: FundDescription): boolean {
  const [shorter, longer] = a.text.length <= b.text.length ? [a, b] : [b, a];
  if (shorter.text.length < MIN_IDENTIFYING_DESCRIPTION_LENGTH) return false;
  if (shorter.text === longer.text) return true;
  if (shorter.phrases.size < MIN_IDENTIFYING_PHRASES) return false;
  let shared = 0;
  for (const phrase of shorter.phrases) if (longer.phrases.has(phrase)) shared += 1;
  return shared / shorter.phrases.size >= MIN_SHARED_PHRASE_RATIO;
}

const TIER_PREFERENCE: Record<string, number> = {
  student_ready: 0,
  limited_but_safe: 1,
  operator_review: 2,
  suppressed: 3,
};

const tierPreference = (tier: unknown): number => TIER_PREFERENCE[String(tier)] ?? 4;

const fellowshipDatabasePreference = (sourceName: unknown): number =>
  sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE ? 0 : 1;

function preferredCopy(a: ProgramDuplicateCandidate, b: ProgramDuplicateCandidate): number {
  return (
    fellowshipDatabasePreference(a.sourceName) - fellowshipDatabasePreference(b.sourceName) ||
    tierPreference(a.tier) - tierPreference(b.tier) ||
    a.id.localeCompare(b.id)
  );
}

// Safe despite #3988 because this rule only joins copies whose fund page is EQUAL and never
// splits on a differing one. The titles must still agree, because a catalog page can give one
// fund another fund's link.
function fundPageIdentities(program: ProgramDuplicateCandidate): string[] {
  const urls = [
    program.sourceUrl,
    program.applicationLink,
    ...(program.links || []).map((link) => link?.url),
  ];
  return [...new Set(urls.map(recordSpecificApplicationPortalIdentity).filter(Boolean))];
}

const AWARD_NOUN_FORMS: Readonly<Record<string, string>> = {
  fellows: 'fellow',
  fellowship: 'fellow',
  fellowships: 'fellow',
  scholars: 'scholar',
  scholarship: 'scholar',
  scholarships: 'scholar',
  grants: 'grant',
  awards: 'award',
  prizes: 'prize',
};

// A fund page names its award in one form and a catalog in another ("Undergraduate
// Fellowship", "Undergraduate Fellows Program"), so the award noun is compared by its stem and
// a trailing "program" is dropped. The shared fund page is still required (#4289).
const titleKeyWithoutAsides = (title: unknown): string =>
  programFundTitleKey(String(title || '').replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .map((word) => AWARD_NOUN_FORMS[word] ?? word)
    .join(' ')
    .replace(/ programs?$/, '');

function titlesNameOneFund(a: unknown, b: unknown): boolean {
  const keyA = programFundTitleKey(a);
  const keyB = programFundTitleKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  const [shorter, longer] = [titleKeyWithoutAsides(a), titleKeyWithoutAsides(b)].sort(
    (x, y) => x.length - y.length,
  );
  return !!shorter && ` ${longer} `.includes(` ${shorter} `);
}

function groupIndexes(
  programs: readonly ProgramDuplicateCandidate[],
  keysOf: (program: ProgramDuplicateCandidate) => string[],
): number[][] {
  const groups = new Map<string, number[]>();
  programs.forEach((program, index) => {
    for (const key of keysOf(program)) {
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(index);
      else groups.set(key, [index]);
    }
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function forEachPair(indexes: readonly number[], visit: (a: number, b: number) => void): void {
  for (let a = 0; a < indexes.length; a += 1) {
    for (let b = a + 1; b < indexes.length; b += 1) visit(indexes[a], indexes[b]);
  }
}

/**
 * Maps each redundant copy of a fund to the copy that is served in its place. The kept copy
 * is the Yale fellowship database's record whenever the fund has one (owner decision, #4289),
 * then the one most fit to serve on its own, then the oldest row.
 */
export function selectDuplicateProgramCopies(
  programs: readonly ProgramDuplicateCandidate[],
): Map<string, string> {
  const fundOf = programs.map((_, index) => index);
  const root = (index: number): number => {
    while (fundOf[index] !== index) index = fundOf[index];
    return index;
  };
  const join = (a: number, b: number): void => {
    fundOf[root(b)] = root(a);
  };

  const descriptions = programs.map((program) => fundDescription(program.description));
  for (const copies of groupIndexes(programs, (program) => [programFundTitleKey(program.title)])) {
    forEachPair(copies, (a, b) => {
      if (sameFundDescription(descriptions[a], descriptions[b])) join(a, b);
    });
  }
  for (const copies of groupIndexes(programs, fundPageIdentities)) {
    forEachPair(copies, (a, b) => {
      if (titlesNameOneFund(programs[a].title, programs[b].title)) join(a, b);
    });
  }

  const funds = new Map<number, ProgramDuplicateCandidate[]>();
  programs.forEach((program, index) => {
    const fund = funds.get(root(index));
    if (fund) fund.push(program);
    else funds.set(root(index), [program]);
  });

  const keptCopyById = new Map<string, string>();
  for (const fund of funds.values()) {
    if (fund.length < 2) continue;
    const [kept, ...redundant] = [...fund].sort(preferredCopy);
    for (const copy of redundant) keptCopyById.set(copy.id, kept.id);
  }
  return keptCopyById;
}
