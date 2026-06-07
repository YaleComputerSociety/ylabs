const DESCRIPTION_FIELDS = ['description', 'shortDescription', 'fullDescription'] as const;

type FacultyResearchTextEntity = {
  displayName?: string | null;
  name?: string | null;
  kind?: string | null;
  entityType?: string | null;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function isResearchEntitySourceChromeText(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  const compact = compactText(cleaned);
  if (
    [
      'administrationncidesignationhistory',
      'communityoutreachcommunityadvisoryboardprograms',
      'patientinformationcancertypes',
      'bythenumbersinformationresourcesresearchtrainingmeetourteam',
      'ysmhomeinformationforaboutysmfacultystaffstudentsresidentsfellowspatientsresearchersalumni',
      'viewdoctorprofileadditionaltitles',
      'viewthisdoctorsclinicalprofile',
      'currentmemberscollaboratorslablifealumni',
      'getinvolvedparticipatecontactus',
      'menutoggleextendednavigation',
      'exploreresearchmeetthelababoutabout',
      'peopleeventsresearchcoursesopportunitiesnewsresearch',
      'facultyresearchinitiativesarecurrentlyactive',
    ].some((fragment) => compact.includes(fragment))
  ) {
    return true;
  }
  return [
    /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
    /\bORCID\s*/i,
    /Publications\s*Timeline/i,
    /\bYSM Researchers?\b/i,
    /ResearchersView/i,
    /View\s+(?:Lab Website|Full Profile|Related Publications?|Related Publication)/i,
    /View\s+\d+\s+(?:Common|Related)\s+Publications?/i,
    /\b(?:Common|Related)\s+Publications?\b/i,
    /Yale Co-Authors/i,
    /Streamline Icon/i,
    /^eduHQ\s*\d/i,
    /\bCitations\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isBrokenResearchEntityDescriptionFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return (
    /^Dr[.,]\s+(?:using|with|in|and)\b/i.test(cleaned) ||
    /^(?:focuses\s+in|of\s+|is\s+in\s+)/i.test(cleaned) ||
    /\b(?:and|with|by)\s+(?:[A-Z][a-z]+\s+[A-Z]\.|[A-Z][a-z]+\.|[A-Z]\.|Dr\.)$/.test(
      cleaned,
    )
  );
}

export function isSyntheticResearchHomeMetadataDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return [
    /^research home connected to\b.*\.$/i,
    /^research home focused on\b.*\.$/i,
    /^.+ is a Yale research home(?: connected to\b.*)?\. This context is synthesized from indexed Yale(?: source)? metadata and should be checked against (?:the linked official sources|official sources before outreach)\.$/i,
    /\band\s*\./i,
    /\bconnected to\s*\./i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isResearchAreaPlaceholderDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return /^research areas?\s*(?::|include\b)/i.test(cleaned);
}

export function isAcademicAppointmentDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  const hasResearchDescriptionVerb =
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs)\b/i.test(
      cleaned,
    );
  if (hasResearchDescriptionVerb) return false;

  return [
    /^Department Chair\b.*\bProfessor of\b/i,
    /\bProfessor of\b.*;\s*Affiliated Faculty\b/i,
    /\bProfessor of\b.*\bDirector,\s+Yale\b/i,
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+\s+is\s+(?:an?\s+)?(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
    /\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b.*\bPrincipal Investigator\b/i,
    /\bPrincipal Investigator\b.*\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isRoleOnlyTitleFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned || cleaned.length > 120) return false;
  const titlePatterns = [
    /^(?:track\s+)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:co-)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:principal\s+investigator|faculty|lecturer|instructor)\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /\b(?:course|program|track|site|center|centre|department)\s+director\b/i,
  ];
  if (titlePatterns.some((pattern) => pattern.test(cleaned))) return true;

  const hasResearchDescriptionVerb =
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches)\b/i.test(
      cleaned,
    );
  if (hasResearchDescriptionVerb) return false;

  return false;
}

export function isContactRouteDescriptionSnippet(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return [
    /^Contact:\s*.+?\bWebsite:\s*https?:\/\//i,
    /^Contact:\s*.+?@.+?\b/i,
    /^Website:\s*https?:\/\/\S+\s+(?:Contact:|We have projects|Students interested)/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function publicResearchEntityDescriptionText(value: unknown): string {
  const cleaned = textValue(value);
  if (
    !cleaned ||
    isContactRouteDescriptionSnippet(cleaned) ||
    isResearchAreaPlaceholderDescription(cleaned) ||
    isAcademicAppointmentDescription(cleaned) ||
    isRoleOnlyTitleFragment(cleaned) ||
    isSyntheticResearchHomeMetadataDescription(cleaned) ||
    isBrokenResearchEntityDescriptionFragment(cleaned) ||
    isResearchEntitySourceChromeText(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

export function sanitizeResearchEntityPublicDescriptionFields<T extends Record<string, any>>(
  entity: T,
): T {
  let changed = false;
  const next: Record<string, any> = { ...entity };

  for (const field of DESCRIPTION_FIELDS) {
    if (field in next) {
      const cleaned = publicResearchEntityDescriptionText(next[field]);
      if (cleaned !== next[field]) {
        next[field] = cleaned;
        changed = true;
      }
    }
  }

  if ('summary' in next) {
    const cleaned = publicResearchEntityDescriptionText(next.summary);
    if (cleaned !== next.summary) {
      next.summary = cleaned;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}

export function isFacultyResearchTextEntity(entity?: FacultyResearchTextEntity | null): boolean {
  return Boolean(
    entity &&
      (entity.kind === 'individual' ||
        entity.kind === 'solo' ||
        entity.entityType === 'FACULTY_RESEARCH_AREA' ||
        entity.entityType === 'INDIVIDUAL_RESEARCH'),
  );
}

function facultyResearchLabelBase(entity: FacultyResearchTextEntity): string {
  return textValue(entity.displayName || entity.name)
    .replace(/\s+(?:Faculty Research|Lab|Laboratory)$/i, '')
    .trim();
}

function possessiveName(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

export function sanitizeFacultyResearchEntityText(
  value: string,
  entity?: FacultyResearchTextEntity | null,
): string {
  if (!isFacultyResearchTextEntity(entity)) return value;
  const baseName = facultyResearchLabelBase(entity || {});
  const possessive = baseName ? possessiveName(baseName) : "This faculty member's";

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
}

export function sanitizeFacultyResearchEntityCopyFields<T extends Record<string, any>>(
  entity: T,
): T {
  if (!isFacultyResearchTextEntity(entity)) return entity;
  let changed = false;
  const next: Record<string, any> = { ...entity };

  for (const field of [...DESCRIPTION_FIELDS, 'profileSynthesisDescription'] as const) {
    if (typeof next[field] !== 'string') continue;
    const cleaned = sanitizeFacultyResearchEntityText(next[field], next);
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}
