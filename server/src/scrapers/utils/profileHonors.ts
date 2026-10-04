import * as cheerio from 'cheerio';

export type ProfileHonorKind = 'fellowship' | 'prize' | 'membership';

export interface ProfileHonor {
  key: string;
  label: string;
  kind: ProfileHonorKind;
  year?: number;
}

interface HonorCatalogEntry {
  key: string;
  label: string;
  kind: ProfileHonorKind;
  pattern: RegExp;
}

export const PROFILE_HONOR_CATALOG: readonly HonorCatalogEntry[] = [
  {
    key: 'guggenheim',
    label: 'Guggenheim Fellowship',
    kind: 'fellowship',
    pattern:
      /\b(?:John Simon )?Guggenheim(?: Memorial)?(?: Foundation)?(?: Fellow(?:ship)?s?)?\b(?!\s+Museum)/i,
  },
  {
    key: 'acls',
    label: 'American Council of Learned Societies',
    kind: 'fellowship',
    pattern: /\bAmerican Council of Learned Societies\b|\bACLS\b/,
  },
  {
    key: 'neh',
    label: 'National Endowment for the Humanities',
    kind: 'fellowship',
    pattern: /\bNational Endowment for the Humanities\b|\bNEH\b/,
  },
  {
    key: 'macarthur',
    label: 'MacArthur Fellowship',
    kind: 'fellowship',
    pattern: /\bMacArthur(?: Foundation)? (?:Fellow(?:ship)?|["“]?genius)/i,
  },
  {
    key: 'carnegie',
    label: 'Andrew Carnegie Fellowship',
    kind: 'fellowship',
    pattern: /\bAndrew Carnegie Fellow(?:ship)?\b|\bCarnegie Fellow(?:ship)?\b/i,
  },
  {
    key: 'sloan',
    label: 'Sloan Research Fellowship',
    kind: 'fellowship',
    pattern: /\bSloan (?:Research )?Fellow(?:ship)?\b|\bAlfred P\.? Sloan (?:Research )?Fellow/i,
  },
  {
    key: 'fulbright',
    label: 'Fulbright',
    kind: 'fellowship',
    pattern: /\bFulbright\b/,
  },
  {
    key: 'mellon-new-directions',
    label: 'Mellon New Directions Fellowship',
    kind: 'fellowship',
    pattern: /\bMellon (?:Foundation )?New Directions\b/i,
  },
  {
    key: 'humboldt',
    label: 'Humboldt Research Award',
    kind: 'fellowship',
    pattern: /\bHumboldt (?:Research )?(?:Award|Prize|Fellow(?:ship)?)\b/i,
  },
  {
    key: 'ias',
    label: 'Institute for Advanced Study',
    kind: 'fellowship',
    pattern: /(?<!Radcliffe )(?<!Netherlands )(?<!Collegium )\bInstitute for Advanced Study\b/i,
  },
  {
    key: 'radcliffe',
    label: 'Radcliffe Institute',
    kind: 'fellowship',
    pattern: /\bRadcliffe (?:Institute|Fellow(?:ship)?)\b/i,
  },
  {
    key: 'national-humanities-center',
    label: 'National Humanities Center',
    kind: 'fellowship',
    pattern: /\bNational Humanities Center\b/i,
  },
  {
    key: 'casbs',
    label: 'Center for Advanced Study in the Behavioral Sciences',
    kind: 'fellowship',
    pattern: /\bCenter for Advanced Study in the Behavio(?:u)?ral Sciences\b|\bCASBS\b/,
  },
  {
    key: 'rome-prize',
    label: 'Rome Prize',
    kind: 'prize',
    pattern: /\bRome Prize\b|\bAmerican Academy in Rome\b/i,
  },
  {
    key: 'berlin-prize',
    label: 'Berlin Prize',
    kind: 'prize',
    pattern: /\bBerlin Prize\b|\bAmerican Academy in Berlin\b/i,
  },
  { key: 'pulitzer', label: 'Pulitzer Prize', kind: 'prize', pattern: /\bPulitzer Prize\b/i },
  { key: 'bancroft', label: 'Bancroft Prize', kind: 'prize', pattern: /\bBancroft Prize\b/i },
  {
    key: 'national-book-award',
    label: 'National Book Award',
    kind: 'prize',
    pattern: /\bNational Book Award\b/i,
  },
  {
    key: 'nbcc',
    label: 'National Book Critics Circle Award',
    kind: 'prize',
    pattern: /\bNational Book Critics Circle Award\b/i,
  },
  { key: 'grammy', label: 'Grammy Award', kind: 'prize', pattern: /\bGrammy(?: Award)?\b/i },
  { key: 'kluge', label: 'Kluge Prize', kind: 'prize', pattern: /\bKluge Prize\b/i },
  { key: 'holberg', label: 'Holberg Prize', kind: 'prize', pattern: /\bHolberg Prize\b/i },
  { key: 'balzan', label: 'Balzan Prize', kind: 'prize', pattern: /\bBalzan Prize\b/i },
  { key: 'nobel', label: 'Nobel Prize', kind: 'prize', pattern: /\bNobel Prize\b/i },
  {
    key: 'amacad',
    label: 'American Academy of Arts and Sciences',
    kind: 'membership',
    pattern: /\bAmerican Academy of Arts (?:and|&) Sciences\b/i,
  },
  {
    key: 'aps',
    label: 'American Philosophical Society',
    kind: 'membership',
    pattern: /\bAmerican Philosophical Society\b/i,
  },
  {
    key: 'british-academy',
    label: 'British Academy',
    kind: 'membership',
    pattern: /\b(?:Corresponding )?Fellow of the British Academy\b/i,
  },
  {
    key: 'nas',
    label: 'National Academy of Sciences',
    kind: 'membership',
    pattern: /\bNational Academy of Sciences\b/i,
  },
  {
    key: 'nam',
    label: 'National Academy of Medicine',
    kind: 'membership',
    pattern: /\bNational Academy of Medicine\b|\bInstitute of Medicine\b/i,
  },
];

const HONORS_HEADING =
  /^\s*(?:selected\s+)?(?:honou?rs?|awards?|fellowships?|prizes?|distinctions?|recognitions?)(?:\s*(?:,|and|&)\s*(?:honou?rs?|awards?|fellowships?|prizes?|distinctions?|recognitions?|grants?))*\s*:?\s*$/i;
const RECEIPT_VERB =
  /\b(?:awarded|received|receiving|receives|recipient|won|wins|winner|elected|named|holds?|held|honou?red|granted|fellow(?:ship)?s? (?:at|from|of)|(?:was|is|has been|became) (?:an?|the) [^.]{0,40}fellow|member of|(?:work|research|scholarship|project|book)s? (?:has|have)? ?(?:been |was |were |is )?(?:supported|funded) by)\b/i;
const PERSON_SUBJECT = /\b(?:he|she|they|his|her|their|professor|prof\.|dr\.)\b/i;
const REFUSED_CONTEXT =
  /\b(?:nominat\w*|finalist|shortlist\w*|longlist\w*|advis\w*|mentor\w*|judg\w*|jur(?:y|or)|committee|chair(?:ed|s|ing)? (?:of|the) (?:[a-z]+ )?(?:committee|panel|jury|selection)|director of|selection|applicants?|students?|undergraduates?|alumn\w*|mellon mays|program officer|panel(?:ist)?|reviewer|proceedings of|journal of)\b/i;
const YEAR = /\b(19[5-9]\d|20\d\d)\b/g;
const NEAR_YEAR_CHARS = 60;

function yearNear(
  text: string,
  start: number,
  end: number,
  currentYear: number,
): number | undefined {
  let best: { year: number; distance: number } | undefined;
  for (const match of text.matchAll(YEAR)) {
    const year = Number(match[1]);
    if (year > currentYear) continue;
    const at = match.index ?? 0;
    const distance = at >= end ? at - end : at + match[0].length <= start ? start - at : 0;
    if (distance > NEAR_YEAR_CHARS) continue;
    if (!best || distance < best.distance || (distance === best.distance && year > best.year)) {
      best = { year, distance };
    }
  }
  return best?.year;
}

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

function surnameOf(personName: string): string {
  const tokens = collapse(personName)
    .replace(/[,.]/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1);
  return tokens[tokens.length - 1] ?? '';
}

function sentencesOf(text: string): string[] {
  return collapse(text)
    .split(/(?<=[.!?;])\s+(?=[A-Z“"(])/)
    .map(collapse)
    .filter((sentence) => sentence.length >= 12);
}

function honorsIn(
  unit: string,
  requireReceipt: boolean,
  surname: string,
  currentYear: number,
): ProfileHonor[] {
  if (REFUSED_CONTEXT.test(unit)) return [];
  if (requireReceipt) {
    if (!RECEIPT_VERB.test(unit)) return [];
    const namesPerson =
      PERSON_SUBJECT.test(unit) || (surname && new RegExp(`\\b${surname}\\b`, 'i').test(unit));
    if (!namesPerson) return [];
  }
  const found: ProfileHonor[] = [];
  for (const entry of PROFILE_HONOR_CATALOG) {
    const match = entry.pattern.exec(unit);
    if (!match) continue;
    const start = match.index;
    const year = yearNear(unit, start, start + match[0].length, currentYear);
    found.push({
      key: entry.key,
      label: entry.label,
      kind: entry.kind,
      ...(year ? { year } : {}),
    });
  }
  return found;
}

function honorsSectionItems($: cheerio.CheerioAPI): string[] {
  const items: string[] = [];
  $('h1, h2, h3, h4, h5, h6, dt, strong, b').each((_, heading) => {
    const label = collapse($(heading).text());
    if (!HONORS_HEADING.test(label)) return;
    const headingTag = heading.tagName?.toLowerCase();
    let node = $(heading).closest('h1, h2, h3, h4, h5, h6, dt, p, div').first();
    if (!node.length) node = $(heading);
    let sibling = node.next();
    for (let step = 0; sibling.length && step < 12; step++) {
      if (sibling.is('h1, h2, h3, h4, h5, h6') || (headingTag === 'dt' && sibling.is('dt'))) break;
      const listItems = sibling.find('li').addBack('li');
      if (listItems.length) listItems.each((__, li) => void items.push(collapse($(li).text())));
      else items.push(...collapse(sibling.text()).split(/\s*(?:\n|;|•)\s*/));
      sibling = sibling.next();
    }
  });
  return items.filter((item) => item.length >= 4 && item.length <= 400);
}

/**
 * Honors a profile page states for its own person, keyed by catalog entry. A dated
 * mention beats an undated one, and the latest year wins.
 */
export function extractProfileHonors(
  html: string,
  personName: string,
  currentYear: number,
): ProfileHonor[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, form, aside').remove();
  const surname = surnameOf(personName);
  const found = [
    ...honorsSectionItems($).flatMap((item) => honorsIn(item, false, surname, currentYear)),
    ...sentencesOf($('body').text()).flatMap((sentence) =>
      honorsIn(sentence, true, surname, currentYear),
    ),
  ];
  const byKey = new Map<string, ProfileHonor>();
  for (const honor of found) {
    const held = byKey.get(honor.key);
    if (!held || (honor.year ?? 0) > (held.year ?? 0)) byKey.set(honor.key, honor);
  }
  return [...byKey.values()].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.label.localeCompare(b.label),
  );
}
