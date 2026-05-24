const DESCRIPTION_FIELDS = ['description', 'shortDescription', 'fullDescription'] as const;

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
    /\bCitations\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isBrokenResearchEntityDescriptionFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return /^Dr[.,]\s+(?:using|with|in|and)\b/i.test(cleaned);
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

export function publicResearchEntityDescriptionText(value: unknown): string {
  const cleaned = textValue(value);
  if (
    !cleaned ||
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
