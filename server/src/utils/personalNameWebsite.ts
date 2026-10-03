const RESEARCH_UNIT_WORD =
  /(?:lab|labs|laboratory|group|research|center|centre|institute|program)/i;

const foldedLetters = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');

const nameTokens = (personName: string): string[] =>
  personName
    .replace(/\b(?:dr|prof|md|phd|mph|jr|sr|ii|iii)\b\.?/gi, ' ')
    .split(/[\s,]+/)
    .map(foldedLetters)
    .filter((token) => token.length > 1);

function personNameSpellings(personName: string): Set<string> {
  const tokens = nameTokens(personName);
  if (tokens.length < 2) return new Set();
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  return new Set([first + last, last + first, tokens.join(''), `${first[0]}${last}`]);
}

const registrableLabel = (hostname: string): string => {
  const labels = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return labels.length >= 2 ? labels[labels.length - 2] : (labels[0] ?? '');
};

/**
 * Whether a URL is a person's own name-domain site (`<first><last>.com`) rather than a
 * lab's. Such a site names a person, so a directory's "lab website" slot linking it names
 * no lab, and a row typed and named as one from that slot asserts a lab the evidence
 * never states. A research-unit word anywhere in the address keeps it a lab site.
 */
export function isPersonalNameDomainWebsite(url: unknown, personName: unknown): boolean {
  if (typeof url !== 'string' || typeof personName !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (/(?:^|\.)yale\.edu$/i.test(parsed.hostname)) return false;
  if (RESEARCH_UNIT_WORD.test(`${parsed.hostname}${parsed.pathname}`)) return false;
  if (parsed.pathname.split('/').filter(Boolean).length > 1) return false;
  return personNameSpellings(personName).has(foldedLetters(registrableLabel(parsed.hostname)));
}
