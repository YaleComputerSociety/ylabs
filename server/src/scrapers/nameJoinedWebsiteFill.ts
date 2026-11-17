const FIRST_HAND_PROFILE_WEBSITE_SOURCES: ReadonlySet<string> = new Set([
  'official-profile-pi-backfill',
  'ysm-faculty-directory',
  'yse-faculty-directory',
]);

const MIN_SURNAME_LENGTH = 3;

const compact = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const surnameOf = (name: unknown): string => {
  if (typeof name !== 'string') return '';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 1 ? compact(tokens[tokens.length - 1]) : '';
};

function urlCarriesSurname(url: string, surname: string): boolean {
  if (surname.length < MIN_SURNAME_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return compact(`${parsed.hostname}${parsed.pathname}`).includes(surname);
  } catch {
    return false;
  }
}

/**
 * Whether a key joined on the person's name alone may fill an empty website (#6432). The name
 * is that key's only identity witness, and a blind sample found roster websites of a lab not
 * named for the person and not linked from their own profile filling such rows, so the fill
 * needs the website itself to witness the person: it carries their surname, or a first-hand
 * profile lane, which reads a website only from the person's own profile page, states it.
 */
export function nameJoinedWebsiteFillIsWitnessed(input: {
  url: string;
  personName: unknown;
  contributingSources: readonly string[] | undefined;
}): boolean {
  if (
    (input.contributingSources ?? []).some((source) =>
      FIRST_HAND_PROFILE_WEBSITE_SOURCES.has(source),
    )
  ) {
    return true;
  }
  return urlCarriesSurname(input.url, surnameOf(input.personName));
}
