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

export type ResearchEntityCopyInput = {
  displayName?: string | null;
  name?: string | null;
  kind?: string | null;
  entityType?: string | null;
  descriptionSource?: string | null;
};

export const isFacultyResearchEntity = (entity?: ResearchEntityCopyInput | null): boolean =>
  Boolean(
    entity &&
      (entity.kind === 'individual' ||
        entity.kind === 'solo' ||
        entity.entityType === 'FACULTY_RESEARCH_AREA' ||
        entity.entityType === 'INDIVIDUAL_RESEARCH'),
  );

export const entityKindLabel = (entity?: ResearchEntityCopyInput | null): string => {
  if (isFacultyResearchEntity(entity)) return 'Faculty Research';
  return KIND_LABELS[entity?.kind || ''] || 'Research Home';
};

export const researchWebsiteLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'research website' : 'lab website';

export const researchWebsiteCtaLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'Visit research website' : 'Visit lab website';

export const researchStructureLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity) ? 'faculty research profile' : 'lab';

export const decisionHeadingLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity)
    ? 'What this faculty research area covers'
    : 'What this lab studies';

export const approachHeadingLabel = (entity?: ResearchEntityCopyInput | null): string =>
  isFacultyResearchEntity(entity)
    ? 'Ways to approach this research profile'
    : 'Ways to approach this lab';

const facultyResearchLabelBase = (entity: ResearchEntityCopyInput): string =>
  String(entity.displayName || entity.name || '')
    .replace(/\s+(?:Faculty Research|Lab|Laboratory)$/i, '')
    .trim();

const toPossessiveName = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

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
