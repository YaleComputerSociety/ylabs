export interface ProfileAreaDuplicateEntity {
  slug?: string;
  name?: string;
  kind?: string;
  entityType?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

const fundingPortalHosts = ['reporter.nih.gov', 'nih.gov', 'nsf.gov', 'api.nsf.gov'];

const nonLabWebsitePathPatterns = [
  /\/profile\//i,
  /\/(?:people|faculty|directory|members|membership|humans)\b/i,
  /(?:^|\.)orcid\.org/i,
  /(?:^|\.)doi\.org/i,
  /(?:^|\.)openalex\.org/i,
  /(?:^|\.)crossref\.org/i,
];

function isFundingPortalHost(host: string): boolean {
  return fundingPortalHosts.some((portal) => host === portal || host.endsWith(`.${portal}`));
}

function isConcreteLabWebsiteUrl(value: string | undefined): boolean {
  const text = (value || '').trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (isFundingPortalHost(host)) return false;
    const hostPath = `${host}${url.pathname}`.replace(/\/+$/, '');
    return !nonLabWebsitePathPatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return false;
  }
}

const individualEntityTypes = new Set(['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH']);
const concreteKinds = new Set(['lab', 'center', 'institute', 'program', 'initiative', 'group']);
const concreteEntityTypes = new Set([
  'LAB',
  'CENTER',
  'INSTITUTE',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'RA_PROGRAM',
  'FELLOWSHIP_PROGRAM',
  'COURSE_SEQUENCE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'PROGRAM',
  'INITIATIVE',
  'GROUP',
]);

export function normalizedProfileAreaWords(value: string | undefined): string[] {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function profileAreaShellNameMatchesPerson(
  entity: ProfileAreaDuplicateEntity,
  firstName?: string,
  lastName?: string,
): boolean {
  const first = normalizedProfileAreaWords(firstName)[0];
  const last = normalizedProfileAreaWords(lastName).at(-1);
  if (!first || !last) return true;

  const values = [entity.name, entity.slug?.replace(/^faculty-research-area-/i, '')];
  return values.some((value) => {
    const words = normalizedProfileAreaWords(value);
    return words.includes(first) && words.includes(last);
  });
}

export function isProfileAreaShellEntity(
  entity: ProfileAreaDuplicateEntity,
  options: { firstName?: string; lastName?: string } = {},
): boolean {
  const slug = (entity.slug || '').toLowerCase();
  const kind = (entity.kind || '').toLowerCase();
  const entityType = (entity.entityType || '').toUpperCase();
  const shellShape =
    slug.startsWith('faculty-research-area-') ||
    kind === 'individual' ||
    kind === 'solo' ||
    individualEntityTypes.has(entityType);

  return (
    shellShape && profileAreaShellNameMatchesPerson(entity, options.firstName, options.lastName)
  );
}

export function isConcreteResearchHomeEntity(entity: ProfileAreaDuplicateEntity): boolean {
  if (isProfileAreaShellEntity(entity)) return false;
  const kind = (entity.kind || '').toLowerCase();
  const entityType = (entity.entityType || '').toUpperCase();
  if (concreteKinds.has(kind) || concreteEntityTypes.has(entityType)) return true;
  return (
    !kind && !entityType && !(entity.slug || '').toLowerCase().startsWith('faculty-research-area-')
  );
}

export function concreteLabWebsiteForEntity(
  entity: ProfileAreaDuplicateEntity,
): string | undefined {
  return [entity.websiteUrl, ...(entity.sourceUrls || [])].find((value) =>
    isConcreteLabWebsiteUrl(value),
  );
}

export function entityCarriesConcreteWebsite(entity: ProfileAreaDuplicateEntity): boolean {
  return Boolean(concreteLabWebsiteForEntity(entity));
}
