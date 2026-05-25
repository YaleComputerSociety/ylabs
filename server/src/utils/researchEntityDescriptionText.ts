const DESCRIPTION_FIELDS = ['description', 'shortDescription', 'fullDescription'] as const;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function stripResearchEntityDescriptionChrome(value: unknown): string {
  let cleaned = textValue(value);
  if (!cleaned) return '';

  cleaned = cleaned
    .replace(/^INFORMATION FOR\s+(?=Copy Link\b|[A-Z])/i, '')
    .replace(/\bCopy Link\b/gi, ' ')
    .replace(/([a-z])\.([A-Z])/g, '$1. $2')
    .replace(/([a-z]),([a-z])/g, '$1, $2')
    .replace(/([a-z])(?=leading-edge\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  const tailMarkers = [
    /\bResearch\/Training Opportunities\b/i,
    /\bResearch and Training Opportunities\b/i,
    /\bWe welcome enthusiastic\b/i,
    /\bContact Us\b/i,
    /\bContact us\b/i,
    /\bDepartment of [A-Z][\s\S]*\b(?:United States|New Haven,\s*CT)\b/i,
  ];
  const tailIndex = tailMarkers.reduce((best, pattern) => {
    const match = cleaned.match(pattern);
    if (!match || match.index === undefined) return best;
    return best === -1 ? match.index : Math.min(best, match.index);
  }, -1);
  if (tailIndex > 0) {
    cleaned = cleaned.slice(0, tailIndex).trim();
  }

  return cleaned;
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
    /\beduHQ\s*\d/i,
    /\bCitations\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isBrokenResearchEntityDescriptionFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  if (/^Dr[.,]\s+(?:using|with|in|and)\b/i.test(cleaned)) return true;
  if (
    /^[a-z]/.test(cleaned) &&
    /^(?:is|of|focuses?|focused|works|studies|examines|investigates|uses|employs)\b/i.test(
      cleaned,
    )
  ) {
    return true;
  }
  if (/(?:\b(?:Dr|Prof|Mr|Ms|Mrs)|\b[A-Z])\.$/.test(cleaned)) {
    return !/(?:U\.S|U\.K|Ph\.D|M\.D|B\.S|M\.S|Sc\.D)\.$/i.test(cleaned);
  }
  return false;
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
  const cleaned = stripResearchEntityDescriptionChrome(value);
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

  if (
    typeof next.shortDescription === 'string' &&
    typeof next.fullDescription === 'string' &&
    next.shortDescription &&
    next.fullDescription.startsWith(next.shortDescription) &&
    !/[.!?]$/.test(next.shortDescription)
  ) {
    next.shortDescription = '';
    changed = true;
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
