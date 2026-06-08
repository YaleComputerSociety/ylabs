export interface ProfileAreaDuplicateEntity {
  slug?: string;
  name?: string;
  kind?: string;
  entityType?: string;
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

  const values = [
    entity.name,
    entity.slug?.replace(/^faculty-research-area-/i, ''),
  ];
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

  return shellShape && profileAreaShellNameMatchesPerson(entity, options.firstName, options.lastName);
}

export function isConcreteResearchHomeEntity(entity: ProfileAreaDuplicateEntity): boolean {
  if (isProfileAreaShellEntity(entity)) return false;
  const kind = (entity.kind || '').toLowerCase();
  const entityType = (entity.entityType || '').toUpperCase();
  if (concreteKinds.has(kind) || concreteEntityTypes.has(entityType)) return true;
  return !kind && !entityType && !(entity.slug || '').toLowerCase().startsWith('faculty-research-area-');
}
