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
  FACULTY_PROJECT: 'group',
  DIGITAL_HUMANITIES_PROJECT: 'group',
  ARCHIVE_OR_MUSEUM_PROJECT: 'group',
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

const FACULTY_RESEARCH_TITLE_SUFFIX = /\s*(?:[-–—]\s*)?(?:Faculty\s+)?Research$/i;

export const researchEntityTitle = (entity?: ResearchEntityCopyInput | null): string => {
  const base = researchEntityDisplayName(entity);
  if (!isFacultyResearchEntity(entity)) return base;
  const normalized = base.replace(FACULTY_RESEARCH_TITLE_SUFFIX, '').trim();
  return normalized || base;
};

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

const LEADING_PAGE_CHROME = /^(?:Bio Website|Bio|Website|Home)\s+(?=[A-Za-z0-9])/;

export const stripLeadingPageChrome = (value: string): string => {
  let out = value;
  while (LEADING_PAGE_CHROME.test(out)) {
    out = out.replace(LEADING_PAGE_CHROME, '');
  }
  return out;
};

const LEADING_GREETING =
  /^Welcome\s+to\s+[^.!?]{0,80}?\b(?:web\s*pages?|websites?|home\s*pages?|homepages?|sites?|pages?)\s*[.!]+\s*/i;

export const stripLeadingGreeting = (value: string): string => value.replace(LEADING_GREETING, '');

const capitalizeSentenceStarts = (value: string): string =>
  value.replace(/(^|[.!?]\s+)([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());

export const neutralizeFirstPersonResearchCopy = (value: string): string =>
  capitalizeSentenceStarts(
    value
      .replace(/\bIn the (?:laboratory|lab),?\s+we\s+study\b/gi, 'this research studies')
      .replace(/\bIn the (?:laboratory|lab),?\s+we\s+investigate\b/gi, 'this research investigates')
      .replace(/\bResearch in (?:our|the)\s+(?:lab|laboratory)\s+is\s+focused\s+on\b/gi, 'this research is focused on')
      .replace(/\bResearch in (?:our|the)\s+(?:lab|laboratory)\s+focuses\s+on\b/gi, 'this research focuses on')
      .replace(/\bResearch in (?:our|the)\s+(?:lab|laboratory)\s+centers\s+on\b/gi, 'this research centers on')
      .replace(/\bThe projects in (?:our|the)\s+(?:lab|laboratory)\s+have\s+focused\s+on\b/gi, 'this research has focused on')
      .replace(/\bThe projects in (?:our|the)\s+(?:lab|laboratory)\s+focus\s+on\b/gi, 'this research focuses on')
      .replace(/\bmy research\b/gi, 'this research')
      .replace(/\bmy lab(?:'|’)?s?\b/gi, 'this research')
      .replace(/\bmy work\b/gi, 'this research')
      .replace(/\bmy group(?:'|’)?s?\b/gi, 'this research')
      .replace(/\bour lab(?:'|’)?s?\b/gi, 'this research')
      .replace(/\bour research\b/gi, 'this research')
      .replace(/\bour work\b/gi, 'this research')
      .replace(/\bwe are interested in\b/gi, 'this research examines')
      .replace(/\bwe study\b/gi, 'this research studies')
      .replace(/\bwe investigate\b/gi, 'this research investigates')
      .replace(/\bwe develop\b/gi, 'this research develops')
      .replace(/\bwe examine\b/gi, 'this research examines')
      .replace(/\bwe explore\b/gi, 'this research explores')
      .replace(/\bwe use\b/gi, 'this research uses')
      .replace(/\bI study\b/g, 'this research studies')
      .replace(/\bI investigate\b/g, 'this research investigates')
      .replace(/\bI examine\b/g, 'this research examines')
      .replace(/\bI explore\b/g, 'this research explores')
      .replace(/\bI focus on\b/g, 'this research focuses on')
      .replace(/\bI work on\b/g, 'this research focuses on')
      .replace(/\bI develop\b/g, 'this research develops')
      .replace(/\bI use\b/g, 'this research uses')
      .replace(/\bI am interested in\b/g, 'this research examines')
      .replace(/\bI have been interested in\b/g, 'this researcher has been interested in')
      .replace(/\bI['’]ve been interested in\b/g, 'this researcher has been interested in')
      .replace(/\bI teach and research\b/g, 'this researcher teaches and researches')
      .replace(/\bI research\b/g, 'this research examines')
      .replace(/\bI teach\b/g, 'this researcher teaches')
      .replace(/\bI lead\b/g, 'this researcher leads')
      .replace(/\bI co-?founded\b/g, 'this researcher co-founded')
      .replace(/\bI founded\b/g, 'this researcher founded')
      .replace(/\bI co-?authored\b/g, 'this researcher co-authored')
      .replace(/\bI authored\b/g, 'this researcher authored')
      .replace(/\bI direct\b/g, 'this researcher directs')
      .replace(/\bI directed\b/g, 'this researcher directed')
      .replace(/\bI mentor\b/g, 'this researcher mentors')
      .replace(/\bI supervise\b/g, 'this researcher supervises')
      .replace(/\bI collaborate\b/g, 'this researcher collaborates')
      .replace(/\bI aim to\b/g, 'this researcher aims to')
      .replace(/\bI seek to\b/g, 'this researcher seeks to')
      .replace(/\bI led\b/g, 'this researcher led')
      .replace(/\bI received\b/g, 'this researcher received')
      .replace(/\bI earned\b/g, 'this researcher earned')
      .replace(/\bI completed\b/g, 'this researcher completed')
      .replace(/\bI joined\b/g, 'this researcher joined')
      .replace(/\bI served\b/g, 'this researcher served')
      .replace(/\bI wrote\b/g, 'this researcher wrote')
      .replace(/\bI edited\b/g, 'this researcher edited')
      .replace(/\bI developed\b/g, 'this researcher developed')
      .replace(/\bI created\b/g, 'this researcher created')
      .replace(/\bI was\b/g, 'this researcher was')
      .replace(/\bI had\b/g, 'this researcher had')
      .replace(/\bI will\b/g, 'this researcher will')
      .replace(/\bI['’]m\b/g, 'this researcher is')
      .replace(/\bI['’]ve\b/g, 'this researcher has')
      .replace(/\bI['’]ll\b/g, 'this researcher will')
      .replace(/\bI['’]d\b/g, 'this researcher would')
      .replace(/\bI have\b/g, 'this researcher has')
      .replace(/\bI am\b/g, 'this researcher is')
      .replace(/\bmy\b/gi, "this researcher's"),
  );

export const sanitizeResearchEntityCopy = (
  value: string,
  entity?: ResearchEntityCopyInput | null,
): string =>
  neutralizeFirstPersonResearchCopy(
    sanitizeResearchHomeSelfReferenceCopy(
      sanitizeFacultyResearchCopy(stripLeadingGreeting(stripLeadingPageChrome(value)), entity),
      entity,
    ),
  );

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
