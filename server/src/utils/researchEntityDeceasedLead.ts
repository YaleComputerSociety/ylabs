const MIN_HUMAN_LIFESPAN_YEARS = 15;
const MAX_HUMAN_LIFESPAN_YEARS = 120;
const DECEASED_DESCRIPTION_SCAN_WINDOW = 120;

const LIFESPAN_YEAR_RANGE = String.raw`((?:18|19|20)\d{2})\s*[-‒–—―−]\s*((?:19|20)\d{2})`;

const TRAILING_PERSON_NAME_LIFESPAN_RE = new RegExp(
  String.raw`[\s,(]*\(?\s*${LIFESPAN_YEAR_RANGE}\s*\)?\s*$`,
);

const DECEASED_DESCRIPTION_LIFESPAN_RE = new RegExp(
  String.raw`^[A-Z][\p{L}.'’-]+(?:\s+(?:[A-Z]\.?|[A-Z][\p{L}.'’-]+)){0,4}\s*[,(]\s*\(?\s*${LIFESPAN_YEAR_RANGE}`,
  'u',
);

const currentUtcYear = (): number => new Date().getUTCFullYear();

const isDeceasedHumanLifespan = (
  startYear: number,
  endYear: number,
  currentYear: number = currentUtcYear(),
): boolean => {
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return false;
  const span = endYear - startYear;
  return span >= MIN_HUMAN_LIFESPAN_YEARS && span <= MAX_HUMAN_LIFESPAN_YEARS && endYear <= currentYear;
};

export function stripTrailingPersonNameLifespan(
  name: unknown,
  currentYear: number = currentUtcYear(),
): string {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  const match = trimmed.match(TRAILING_PERSON_NAME_LIFESPAN_RE);
  if (!match) return trimmed;
  if (!isDeceasedHumanLifespan(Number(match[1]), Number(match[2]), currentYear)) return trimmed;
  const stripped = trimmed.slice(0, match.index).replace(/[\s,(]+$/, '').trim();
  return stripped || trimmed;
}

export function personNameCarriesLifespan(
  name: unknown,
  currentYear: number = currentUtcYear(),
): boolean {
  return typeof name === 'string' && stripTrailingPersonNameLifespan(name, currentYear) !== name.trim();
}

export function descriptionOpensWithDeceasedLifespan(
  description: unknown,
  currentYear: number = currentUtcYear(),
): boolean {
  if (typeof description !== 'string') return false;
  const opening = description.replace(/\s+/g, ' ').trim().slice(0, DECEASED_DESCRIPTION_SCAN_WINDOW);
  const match = opening.match(DECEASED_DESCRIPTION_LIFESPAN_RE);
  if (!match) return false;
  return isDeceasedHumanLifespan(Number(match[1]), Number(match[2]), currentYear);
}

export function researchEntityHasDeceasedLead(
  entity: Record<string, any> | null | undefined,
  currentYear: number = currentUtcYear(),
): boolean {
  if (!entity) return false;
  if (
    personNameCarriesLifespan(entity.displayName, currentYear) ||
    personNameCarriesLifespan(entity.name, currentYear)
  ) {
    return true;
  }
  return [entity.fullDescription, entity.shortDescription, entity.profileSynthesisDescription].some(
    (text) => descriptionOpensWithDeceasedLifespan(text, currentYear),
  );
}
