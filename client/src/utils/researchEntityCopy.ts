const KIND_LABELS: Record<string, string> = {
  lab: 'Lab',
  center: 'Center',
  institute: 'Institute',
  program: 'Program',
  initiative: 'Initiative',
  group: 'Group',
  individual: 'Faculty Research',
  solo: 'Faculty Research',
};

const ENTITY_TYPE_TO_KIND: Record<string, string> = {
  LAB: 'lab',
  CENTER: 'center',
  INSTITUTE: 'institute',
  PROGRAM: 'program',
  RA_PROGRAM: 'program',
  FELLOWSHIP_PROGRAM: 'program',
  COURSE_SEQUENCE: 'program',
  INITIATIVE: 'initiative',
  COLLECTIONS_INITIATIVE: 'initiative',
  GROUP: 'group',
  INDIVIDUAL_RESEARCH: 'individual',
  FACULTY_RESEARCH: 'individual',
  FACULTY_RESEARCH_AREA: 'individual',
};

export type ResearchEntityCopyInput = {
  displayName?: string | null;
  name?: string | null;
  kind?: string | null;
  entityType?: string | null;
  descriptionSource?: string | null;
};

const effectiveEntityKind = (entity?: ResearchEntityCopyInput | null): string =>
  ENTITY_TYPE_TO_KIND[entity?.entityType || ''] || entity?.kind || '';

const researchHomeLabel = (entity?: ResearchEntityCopyInput | null): string =>
  KIND_LABELS[effectiveEntityKind(entity)]?.toLowerCase() || 'research home';

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  AFFILIATED_LAB: 'Affiliated lab',
  AFFILIATED_RESEARCH_GROUP: 'Related research group',
  MEMBER_RESEARCH_AREA: 'Member',
  HOSTED_PROGRAM: 'Hosted program',
};

/**
 * Human label for a research-entity relationship edge. Falls back to the
 * relationshipType map when the stored `label` is empty (older edges predate
 * label population in the materializer).
 */
export const relationshipTypeLabel = (relationshipType?: string | null): string =>
  (relationshipType && RELATIONSHIP_TYPE_LABELS[relationshipType]) || '';

export const isFacultyResearchEntity = (entity?: ResearchEntityCopyInput | null): boolean =>
  Boolean(
    entity &&
      (entity.kind === 'individual' ||
        entity.kind === 'solo' ||
        entity.entityType === 'FACULTY_RESEARCH' ||
        entity.entityType === 'FACULTY_RESEARCH_AREA' ||
        entity.entityType === 'INDIVIDUAL_RESEARCH'),
  );

export const researchEntityDisplayName = (entity?: ResearchEntityCopyInput | null): string =>
  String(entity?.displayName || entity?.name || '');

export const entityKindLabel = (entity?: ResearchEntityCopyInput | null): string => {
  if (isFacultyResearchEntity(entity)) return 'Faculty Research';
  return KIND_LABELS[effectiveEntityKind(entity)] || 'Research Home';
};

export const researchWebsiteLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'research website' : `${researchHomeLabel(entity)} website`;

export const researchWebsiteCtaLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'Visit research website' : `Visit ${researchWebsiteLabel(entity)}`;

export const researchStructureLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'faculty research profile' : researchHomeLabel(entity);

export const decisionHeadingLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity)
    ? 'What this faculty research area covers'
    : researchStructureLabel(entity) === 'lab'
      ? 'What this lab studies'
      : `What this ${researchStructureLabel(entity)} focuses on`;

export const approachHeadingLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity)
    ? 'Ways to approach this research profile'
    : `Ways to approach this ${researchStructureLabel(entity)}`;

const facultyResearchLabelBase = (entity: ResearchEntityCopyInput): string =>
  String(entity.displayName || entity.name || '')
    .replace(/\s*[-–—]\s*Research$/i, '')
    .replace(/\s+(?:Faculty Research|Lab|Laboratory|Research)$/i, '')
    .trim();

const toPossessiveName = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

const RESEARCH_HOME_SELF_NOUNS: Record<string, string> = {
  center: 'center',
  institute: 'institute',
  initiative: 'initiative',
  group: 'group',
  program: 'program',
};

const researchHomeSelfReferenceNoun = (entity?: ResearchEntityCopyInput | null): string | null => {
  if (!entity || isFacultyResearchEntity(entity)) return null;
  return RESEARCH_HOME_SELF_NOUNS[effectiveEntityKind(entity)] || null;
};

const matchLeadingCase = (sample: string, replacement: string): string => {
  if (!sample || !replacement) return replacement;
  const lead = sample.charAt(0);
  const isUpper = lead === lead.toUpperCase() && lead !== lead.toLowerCase();
  return isUpper ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
};

export const sanitizeResearchHomeSelfReferenceCopy = (
  value: string,
  entity?: ResearchEntityCopyInput | null,
): string => {
  const noun = researchHomeSelfReferenceNoun(entity);
  if (!noun) return value;
  return value.replace(
    /\b(the|this|our|your|its)(\s+)(lab|laboratory)(['’]s)?\b/gi,
    (_match, determiner: string, spacing: string, labToken: string, possessive?: string) =>
      `${determiner}${spacing}${matchLeadingCase(labToken, noun)}${possessive || ''}`,
  );
};

export const sanitizeFacultyResearchCopy = (
  value: string,
  entity?: ResearchEntityCopyInput | null,
): string => {
  if (!isFacultyResearchEntity(entity)) return value;
  const baseName = facultyResearchLabelBase(entity || {});
  const possessive = baseName ? toPossessiveName(baseName) : "This faculty member's";

  return value
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+(?:focused\s+)?on\b/i,
      `${possessive} research focuses on`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+focuses\s+on\b/i,
      `${possessive} research focuses on`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+investigates\b/i,
      `${possessive} research investigates`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+studies\b/i,
      `${possessive} research studies`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+is\s+connected\s+to\b/i,
      `${possessive} research is connected to`,
    )
    .replace(
      /^Research\s+in\s+the\s+(.+?)\s+(?:Lab|Laboratory)\s+centers\s+on\b/i,
      `${possessive} research centers on`,
    )
    .replace(/\bResearch\s+Lab\b/g, 'research program')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+studies\b/gu, '$1 research studies')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+focuses\s+on\b/gu, '$1 research focuses on')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+uses\b/gu, '$1 research uses')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+develops\b/gu, '$1 research develops')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+investigates\b/gu, '$1 research investigates')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+studies\b/gu, '$1 research studies')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+focuses\s+on\b/gu, '$1 research focuses on')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+uses\b/gu, '$1 research uses')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+develops\b/gu, '$1 research develops')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+investigates\b/gu, '$1 research investigates')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+studies\b/g, '$1 research studies')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+focuses\s+on\b/g, '$1 research focuses on')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+uses\b/g, '$1 research uses')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+develops\b/g, '$1 research develops')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+investigates\b/g, '$1 research investigates')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+is\s+interested\s+in\b/g, '$1 research examines')
    .replace(/^My\s+lab\s+focuses\s+on\b/i, 'This research focuses on')
    .replace(/^My\s+lab\s+studies\b/i, 'This research studies')
    .replace(/\bIn\s+([^.!?]{2,100}?)\s+lab\s+we\s+study\b/i, 'In $1 research, we study')
    .replace(/\bthe\s+lab['’]s\s+work\s+includes\b/gi, 'This research includes')
    .replace(/\bthe\s+lab['’]s\s+research\s+addresses\b/gi, 'This research addresses')
    .replace(/\bthe\s+lab['’]s\s+research\b/gi, 'This research')
    .replace(/\bthe\s+lab['’]s\s+work\b/gi, 'This work')
    .replace(/\bLaboratory\b/g, 'research program')
    .replace(/\blaboratory\b/g, 'research program')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?)\s+Lab\b/gu, '$1 research group')
    .replace(/\blab site\b/gi, 'research website')
    .replace(/\blab website\b/gi, 'research website')
    .replace(/\bthe\s+lab\b/gi, 'this research profile')
    .replace(/\bthis\s+lab\b/gi, 'this research profile')
    .replace(/\bour\s+lab\b/gi, 'this research profile')
    .replace(/\byour\s+lab\b/gi, 'this research profile')
    .replace(/(^|[.!?]\s+)this research\b/g, '$1This research');
};
