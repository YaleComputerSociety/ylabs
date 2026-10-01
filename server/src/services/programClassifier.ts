import type {
  ProgramCategory,
  ProgramEntryMode,
  ProgramKind,
  ProgramRole,
} from '../models/fellowship';
import { classifyProgramResearchRelevance } from './programResearchRelevance';

export interface ProgramClassificationInput {
  title?: string;
  competitionType?: string;
  summary?: string;
  description?: string;
  applicationInformation?: string;
  eligibility?: string;
  additionalInformation?: string;
  purpose?: string[];
  termOfAward?: string[];
  sourceUrl?: string;
}

export interface ProgramClassification {
  programCategory: ProgramCategory;
  programKind: ProgramKind;
  programRole: ProgramRole;
  entryMode: ProgramEntryMode;
  studentFacingCategory: string;
  requiresMentorBeforeApply: boolean;
  mentorMatching: boolean;
  undergraduateOnly?: boolean;
  yaleCollegeOnly?: boolean;
  compensationSummary?: string;
  hoursPerWeek?: number;
  programDates?: string;
  bestNextStep: string;
  prepSteps: string[];
}

type KindClassification = Omit<ProgramClassification, 'programRole'>;

const STARTS_RESEARCH_KINDS: ReadonlySet<ProgramKind> = new Set([
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
  'DEPARTMENT_RESEARCH_GUIDE',
]);

const FUNDS_RESEARCH_KINDS: ReadonlySet<ProgramKind> = new Set([
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
]);

export function programRoleForKind(kind: ProgramKind): ProgramRole {
  if (STARTS_RESEARCH_KINDS.has(kind)) return 'STARTS_RESEARCH';
  if (FUNDS_RESEARCH_KINDS.has(kind)) return 'FUNDS_RESEARCH';
  if (kind === 'RESEARCH_AWARD') return 'RECOGNIZES_RESEARCH';
  return 'UNCLASSIFIED';
}

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function textForProgram(input: ProgramClassificationInput): string {
  return [
    input.title,
    input.competitionType,
    input.summary,
    input.description,
    input.applicationInformation,
    input.eligibility,
    input.additionalInformation,
    ...(input.purpose || []),
    ...(input.termOfAward || []),
    input.sourceUrl,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

// `purpose` is a multi-select of permitted uses, so its "Senior Research Project or Senior
// Essay" entry sits on awards open to first-years (#3904). A statement about who the award
// is for has to come from the record's own prose.
function proseForProgram(input: ProgramClassificationInput): string {
  return [
    input.title,
    input.competitionType,
    input.summary,
    input.description,
    input.applicationInformation,
    input.eligibility,
    input.additionalInformation,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

// A department's own undergraduate research page is a guide to finding a faculty mentor,
// not an award, so it is a way in even though the page mentions funding (#3904).
const DEPARTMENT_RESEARCH_GUIDE_TITLE =
  /^[A-Z][\w&,' -]*\s(?:undergraduate research(?: opportunities)?|research opportunities)$/i;

const NON_UNDERGRADUATE_AUDIENCE_TITLE =
  /\b(?:graduate|professional|postdoc(?:toral)?|doctoral|phd)\b/;

const AWARD_INSTRUMENT_TITLE =
  /\b(?:awards?|grants?|funds?|funding|scholarships?|prizes?|stipends?)\b/;

const RESEARCH_AWARD_TITLE = /\b(?:scholarships?|prizes?)\b/;

const RESEARCH_CAREER_AWARD_PROSE =
  /\b(?:pursue|pursuing|intend(?:s|ing)? to pursue)\s+research careers?\b/;

const SENIOR_RESEARCH_NAME =
  /senior (?:research|essay)|senior project|mellon senior|residential college|richter/;

const SENIOR_RESEARCH_PROSE =
  /([^.]{0,60})\b(?:fund(?:s|ing)?|support(?:s|ing)?|costs? associated with|off-?set)\b([^.]{0,80})\bsenior (?:research project|essay|thesis|project)s?\b/g;

const SENIOR_RESEARCH_EXCLUSION =
  /\b(?:not|cannot|can't|never|ineligible|exclud(?:e|es|ed|ing)|except)\b/;

function proseFundsSeniorResearch(prose: string): boolean {
  return [...prose.matchAll(SENIOR_RESEARCH_PROSE)].some(
    ([, lead, between]) =>
      !SENIOR_RESEARCH_EXCLUSION.test(lead) && !SENIOR_RESEARCH_EXCLUSION.test(between),
  );
}

function identityTextForProgram(input: ProgramClassificationInput): string {
  return [input.title, input.competitionType, input.sourceUrl]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function baseFundingClassification(): KindClassification {
  return {
    programCategory: 'FELLOWSHIP',
    programKind: 'FELLOWSHIP_FUNDING',
    entryMode: 'SECURE_MENTOR_THEN_APPLY',
    studentFacingCategory: 'Funding after mentor',
    requiresMentorBeforeApply: true,
    mentorMatching: false,
    bestNextStep:
      'Find a faculty mentor or sponsor, then use this funding record to plan the application.',
    prepSteps: ['Research plan', 'Faculty mentor or sponsor', 'Official application'],
  };
}

const MENTOR_NOUN = '(?:mentor|sponsor|adviser|advisor|supervisor)s?';

const MENTOR_ROLE = `(?:[\\w-]+ )?(?:faculty |research |project |thesis )?${MENTOR_NOUN}`;

const MENTOR_REQUIREMENT_SENTENCE = new RegExp(
  [
    `\\b(?:requires?|required|must (?:have|secure|identify|find|obtain|include)(?: as)?|needs? (?:to have )?) (?:a |an |the |your )?${MENTOR_ROLE}\\b`,
    `\\b(?:faculty |research |project |thesis )?${MENTOR_NOUN} (?:is|are|must be) (?:required|needed)\\b`,
    `\\bmust have as (?:a |an )?${MENTOR_NOUN} (?:a )?(?:member of the )?faculty\\b`,
    `\\bagreed to (?:be|serve as) (?:the |your |a )?${MENTOR_NOUN}\\b`,
    `\\b(?:written )?commitment from (?:a |an |the )?(?:yale )?faculty member\\b`,
    `\\bname of (?:your|the) (?:faculty )?${MENTOR_NOUN}\\b`,
    `\\bdeveloped with (?:a |an )?(?:potential )?${MENTOR_ROLE}\\b`,
    `\\b(?:signature|approval|endorsement) (?:of|from) (?:the applicant['’]s |your |a |an |the )?[^.]{0,60}?${MENTOR_NOUN}\\b[^.]{0,20}\\b(?:is |are )?required\\b`,
    `\\b${MENTOR_NOUN}['’]s? (?:letter|statement|approval|endorsement|signature) (?:is |are )?required\\b`,
    `\\bunder the (?:supervision|guidance|direction) of (?:a |an )?(?:yale )?faculty\\b`,
  ].join('|'),
  'i',
);

const MENTOR_NOT_REQUIRED_SENTENCE =
  /\b(?:not (?:required|mandatory|necessary)|not required to|(?:is|are) not required|does not require|do not need|don['’]t need|no (?:faculty )?(?:mentor|sponsor|adviser|advisor) (?:is )?(?:required|needed))\b/i;

/**
 * Whether a funding record's own page says a mentor is required. This used to be assumed
 * for every funding record no specific arm claimed, which told students to find a faculty
 * mentor for internship, travel and event funds that ask for none (#4131). A recommendation
 * letter alone is not a mentor requirement. Each sentence is judged on its own, so "a
 * faculty advisor is welcome but not required" cannot be cancelled or confirmed by a
 * different sentence about a letter of reference.
 */
export function mentorRequirementSentence(input: ProgramClassificationInput): string | undefined {
  return proseForProgram(input)
    .split(/(?<=[.!?])\s+|\n+|(?<=[a-z])(?=[A-Z][a-z]+:)/)
    .find(
      (sentence) =>
        MENTOR_REQUIREMENT_SENTENCE.test(sentence) && !MENTOR_NOT_REQUIRED_SENTENCE.test(sentence),
    );
}

function statesMentorRequirement(input: ProgramClassificationInput): boolean {
  return mentorRequirementSentence(input) !== undefined;
}

function fundingClassificationFromPage(input: ProgramClassificationInput): KindClassification {
  if (statesMentorRequirement(input)) return baseFundingClassification();
  return {
    ...baseFundingClassification(),
    entryMode: 'APPLY_TO_PROGRAM',
    studentFacingCategory: 'Fellowship or grant',
    requiresMentorBeforeApply: false,
    bestNextStep:
      'Check the eligibility and application requirements on the official page, then apply.',
    prepSteps: ['Eligibility check', 'Official application'],
  };
}

// A page titled only with award nouns ("Fellowships & Grants", "Undergraduate Grants and
// Prizes") lists many awards rather than being one, so its prose mentions every use any of
// them funds and would otherwise classify as whichever award it names first.
const GENERIC_AWARD_HUB_TITLE =
  /^(?:(?:student|undergraduate|graduate) )?(?:grants?|fellowships?|awards?|prizes?|funding)(?: (?:and|&) (?:grants?|fellowships?|awards?|prizes?|funding))*$/;

export const ARCHIVE_REVIEW_STUDENT_FACING_CATEGORY = 'Archive / review';

function archiveReviewClassification(): KindClassification {
  return {
    programCategory: 'FELLOWSHIP',
    programKind: 'OTHER',
    entryMode: 'TRACK_NEXT_CYCLE',
    studentFacingCategory: ARCHIVE_REVIEW_STUDENT_FACING_CATEGORY,
    requiresMentorBeforeApply: false,
    mentorMatching: false,
    undergraduateOnly: false,
    bestNextStep:
      'Review carefully before relying on this record; it may not be an undergraduate option.',
    prepSteps: ['Eligibility check', 'Official source review'],
  };
}

const GRADUATE_PROFESSIONAL_AUDIENCE =
  /graduate students only|doctoral students?|doctoral dissertation|graduate research assistantships?|graduate and professional(?: school)? students?|master'?s students?|masters students?|phd students?|phd dissertations?|yale university graduate students|postgraduate study|yls graduates|graduate school of arts & sciences|yale law school/;

// An audience of researchers who are not Yale students at all is out of scope for a Yale
// student research surface, so it stays archive review even when the record is research-shaped.
const NON_YALE_STUDENT_AUDIENCE =
  /historians, medical practitioners, and other researchers outside of yale|researchers outside of yale/;

const GRADUATE_TRAVEL_RESEARCH =
  /\btravel\b|\babroad\b|\boverseas\b|\bfield research\b|\bfieldwork\b/;

const COLLECTIONS_RESEARCH_HOST =
  /\blibrar(?:y|ies)\b|\barchival\b|\barchives\b|special collections|\bmuseum\b|\bgallery\b|reading room|\bresidency\b/;

function graduateResearchClassification(lower: string): KindClassification {
  const base: KindClassification = {
    programCategory: 'FELLOWSHIP',
    programKind: 'FELLOWSHIP_FUNDING',
    entryMode: 'SECURE_MENTOR_THEN_APPLY',
    studentFacingCategory: 'Graduate research funding',
    requiresMentorBeforeApply: true,
    mentorMatching: false,
    undergraduateOnly: false,
    bestNextStep:
      'Confirm you meet the graduate or professional eligibility, then line up an adviser and a research plan before applying.',
    prepSteps: [
      'Graduate eligibility check',
      'Adviser or sponsor',
      'Research plan',
      'Official application',
    ],
  };

  if (/\bresearch assistantships?\b/.test(lower)) {
    return {
      ...base,
      programKind: 'RA_PROGRAM',
      entryMode: 'APPLY_TO_PROGRAM',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'Graduate research assistantship',
      bestNextStep:
        'Confirm you meet the graduate or professional eligibility, then apply through the official assistantship route.',
      prepSteps: [
        'Graduate eligibility check',
        'Relevant research experience',
        'Official application',
      ],
    };
  }

  if (GRADUATE_TRAVEL_RESEARCH.test(lower)) {
    return {
      ...base,
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Graduate research travel funding',
      bestNextStep:
        'Confirm you meet the graduate or professional eligibility, then build a research and travel plan with your adviser before applying.',
      prepSteps: [
        'Graduate eligibility check',
        'Research and travel plan',
        'Budget',
        'Official application',
      ],
    };
  }

  if (COLLECTIONS_RESEARCH_HOST.test(lower)) {
    return {
      ...base,
      entryMode: 'APPLY_TO_PROGRAM',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'Graduate collections research fellowship',
      bestNextStep:
        'Confirm you meet the graduate or professional eligibility, then apply directly with a proposal for the on-site research you would do.',
      prepSteps: [
        'Graduate eligibility check',
        'Collections research proposal',
        'Official application',
      ],
    };
  }

  return base;
}

const INTERNSHIP_NAME = /\binternships?\b/;

const FUNDING_INSTRUMENT_NAME =
  /\b(?:fellowships?|grants?|funds?|funding|awards?|scholarships?|prizes?|stipends?)\b/;

// The catch-all internship branch used to read the whole flattened record, and `purpose` is a
// multi-select of permitted uses rather than a description of what the record is: an
// "Internship/Work Project" entry sits beside "Research" and "Senior Research Project or Senior
// Essay" on the same award. Reading that entry, or a prose aside that an award may fund an
// internship, relabelled research and travel funding as an internship program (#2925). An
// internship program names itself one in its own title, and an award that merely permits an
// internship names a funding instrument instead.
function namesInternshipProgram(input: ProgramClassificationInput): boolean {
  const named = [input.title, input.competitionType, input.sourceUrl]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!INTERNSHIP_NAME.test(named)) return false;
  return !FUNDING_INSTRUMENT_NAME.test(normalizeText(input.title).toLowerCase());
}

const DEPARTMENT_PAGE_PATH_SEGMENT = /^(?:departments|undergraduate-study)$/;

function publishedOnDepartmentPage(input: ProgramClassificationInput): boolean {
  const sourceUrl = normalizeText(input.sourceUrl);
  if (!sourceUrl) return false;
  let pathname: string;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    return false;
  }
  return pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => DEPARTMENT_PAGE_PATH_SEGMENT.test(segment));
}

function structuredProgram(overrides: Partial<KindClassification>): KindClassification {
  return {
    programCategory: 'RECURRING_PROGRAM',
    programKind: 'STRUCTURED_PROGRAM',
    entryMode: 'APPLY_TO_PROGRAM',
    studentFacingCategory: 'Structured program',
    requiresMentorBeforeApply: false,
    mentorMatching: false,
    undergraduateOnly: true,
    bestNextStep: 'Review the official program page and prepare the application materials.',
    prepSteps: ['Official application', 'Eligibility check'],
    ...overrides,
  };
}

function classifyProgramKind(input: ProgramClassificationInput): KindClassification {
  const title = normalizeText(input.title);
  const text = textForProgram(input);
  const lower = text.toLowerCase();
  const identityLower = identityTextForProgram(input).toLowerCase();
  const titleLower = title.toLowerCase();
  const hasUndergraduateAudience =
    /\bundergraduate|yale college|first[- ]years?|sophomores?|juniors?|seniors?\b/.test(lower);

  if (
    /^\d+\s*\(/.test(title) ||
    /\bsubjects\b/.test(titleLower) ||
    /^(?:about|advising|administering|alternative funding|find funding|prepare|search)\b/.test(
      titleLower,
    ) ||
    /\bpostgraduate fellowships common application\b/.test(titleLower) ||
    /\b(?:student grants database|funding options|funding sources|faculty staff|fellowships advisers?)\b/.test(
      titleLower,
    )
  ) {
    return archiveReviewClassification();
  }

  if (NON_YALE_STUDENT_AUDIENCE.test(lower)) {
    return archiveReviewClassification();
  }

  // Graduate or professional audience is an honest Graduate label rather than a suppression
  // trigger (#451), so a research-shaped graduate program keeps a real category and only a
  // graduate record with no research dimension falls through to archive review.
  if (
    /not for undergraduates/.test(lower) ||
    (!hasUndergraduateAudience && GRADUATE_PROFESSIONAL_AUDIENCE.test(lower))
  ) {
    const researchRelated = classifyProgramResearchRelevance({
      title: input.title,
      summary: input.summary,
      description: input.description,
      eligibility: input.eligibility,
      purpose: input.purpose,
    }).researchRelated;
    return researchRelated ? graduateResearchClassification(lower) : archiveReviewClassification();
  }

  if (/\btobin\b/.test(identityLower) && /\bresearch assistant/i.test(text)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'RA_PROGRAM',
      entryMode: 'APPLY_TO_PROJECT',
      studentFacingCategory: 'Project posting',
      compensationSummary: '$17/hour',
      hoursPerWeek: 10,
      bestNextStep: 'Choose a posted faculty project and apply through the Tobin RA process.',
      prepSteps: ['Project selection', 'Resume or short application', 'Faculty project fit'],
    });
  }

  const namesStars = /\bSTARS\b/.test(title) || /\/stars\//.test(identityLower);
  if (
    namesStars &&
    /\bmentoring and support program\b|\brather than a direct research placement\b/.test(lower)
  ) {
    return structuredProgram({
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'STEM mentoring program',
      bestNextStep:
        'Apply to the program for mentoring, advising, and community before you look for a lab.',
      prepSteps: ['Eligibility check', 'Official application'],
    });
  }

  if (namesStars && !/\bsummer research program\b/.test(lower) && /\bresearch\b/.test(lower)) {
    return structuredProgram({
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Structured research program',
      requiresMentorBeforeApply: true,
      bestNextStep: 'Secure a Yale faculty research mentor before applying to the program.',
      prepSteps: ['Faculty research mentor', 'Research proposal', 'Official application'],
    });
  }

  if (namesStars && /\bsummer research program\b/.test(lower)) {
    return structuredProgram({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Structured summer program',
      requiresMentorBeforeApply: true,
      compensationSummary: 'Stipend plus housing/board',
      programDates: 'Summer',
      bestNextStep: 'Secure a Yale lab commitment before applying.',
      prepSteps: [
        'Yale lab commitment',
        'Research proposal',
        'Mentor support',
        'Official application',
      ],
    });
  }

  if (/\bwu tsai\b|\bwti\.yale\.edu\b/.test(identityLower)) {
    return structuredProgram({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Mentored summer program',
      mentorMatching: true,
      compensationSummary: 'Summer stipend',
      programDates: 'Summer',
      bestNextStep:
        'Apply to the Wu Tsai undergraduate fellowship and identify possible mentors if listed.',
      prepSteps: ['Interest statement', 'Potential mentor fit', 'Official application'],
    });
  }

  if (/\bwomen'?s health research\b|\bwhr\b/.test(identityLower)) {
    return structuredProgram({
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Mentored academic-year program',
      mentorMatching: true,
      yaleCollegeOnly: true,
      hoursPerWeek: 6,
      programDates: 'Academic Year',
      bestNextStep: 'Apply through WHRY and be ready to discuss women’s health research interests.',
      prepSteps: ['Interest statement', 'Academic-year availability', 'Official application'],
    });
  }

  if (/\byale[- ]uc louvain\b|\buc louvain\b/.test(identityLower)) {
    return structuredProgram({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      entryMode: 'APPLY_TO_PROJECT',
      studentFacingCategory: 'External summer research program',
      requiresMentorBeforeApply: false,
      mentorMatching: false,
      programDates: 'Summer',
      bestNextStep:
        'Review the available UC Louvain research subjects, contact relevant faculty, and apply through the official program route.',
      prepSteps: ['Research subject selection', 'Faculty project fit', 'Official application'],
    });
  }

  if (
    /\bycmd\b|center for molecular discovery|summer undergraduate internships/.test(identityLower)
  ) {
    return structuredProgram({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Center internship',
      compensationSummary: 'Paid internship',
      programDates: 'Summer',
      bestNextStep: 'Apply to the center internship and check project fit.',
      prepSteps: ['Official application', 'Project interest', 'Summer availability'],
    });
  }

  if (/computer science research internship|cs research internship/.test(identityLower)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Faculty matching program',
      mentorMatching: true,
      bestNextStep:
        'Apply to the CS research internship so the committee can consider faculty matches.',
      prepSteps: ['Research interests', 'Relevant coursework', 'Official application'],
    });
  }

  if (/mellon mays|\bbouchet\b/.test(identityLower)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Cohort research program',
      mentorMatching: true,
      compensationSummary: 'Academic-year and summer research support',
      bestNextStep: 'Review the program eligibility and prepare the cohort-program application.',
      prepSteps: ['Faculty mentor fit', 'Research interests', 'Official application'],
    });
  }

  if (GENERIC_AWARD_HUB_TITLE.test(titleLower) || /\bfellowships in the news\b/.test(titleLower)) {
    return archiveReviewClassification();
  }

  if (
    DEPARTMENT_RESEARCH_GUIDE_TITLE.test(title) &&
    !FUNDING_INSTRUMENT_NAME.test(titleLower) &&
    !NON_UNDERGRADUATE_AUDIENCE_TITLE.test(titleLower) &&
    !/\bsummer\b/.test(titleLower)
  ) {
    return {
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'DEPARTMENT_RESEARCH_GUIDE',
      entryMode: 'CONTACT_FACULTY',
      studentFacingCategory: 'Department research guide',
      requiresMentorBeforeApply: false,
      mentorMatching: false,
      ...(/\bundergraduate\b/.test(titleLower) ? { undergraduateOnly: true } : {}),
      bestNextStep:
        "Use the department's guide to find faculty whose research fits your interests, then contact them directly.",
      prepSteps: ['Faculty research fit', 'Short introduction email'],
    };
  }

  if (
    RESEARCH_AWARD_TITLE.test(titleLower) &&
    (RESEARCH_CAREER_AWARD_PROSE.test(proseForProgram(input).toLowerCase()) ||
      /\b(?:essay|thesis|research) prizes?\b/.test(titleLower))
  ) {
    return {
      programCategory: 'FELLOWSHIP',
      programKind: 'RESEARCH_AWARD',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Research award',
      requiresMentorBeforeApply: false,
      mentorMatching: false,
      bestNextStep:
        'Check the eligibility and the campus nomination deadline; this award recognizes research you have already done.',
      prepSteps: ['Research record', 'Faculty recommendation', 'Campus nomination'],
    };
  }

  if (/first[- ]year summer research fellowship/.test(identityLower)) {
    return {
      ...baseFundingClassification(),
      studentFacingCategory: 'Funding after mentor',
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep:
        'Find a Yale faculty mentor and prepare a proposed summer research project before applying.',
      prepSteps: ['Faculty mentor', 'Project proposal', 'Mentor letter', 'Official application'],
    };
  }

  if (/tetelman|bates/.test(identityLower)) {
    return {
      ...baseFundingClassification(),
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Research travel funding',
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep:
        'Develop an independent research plan and faculty support before applying for travel funding.',
      prepSteps: ['Independent research plan', 'Faculty support', 'Budget', 'Official application'],
    };
  }

  if (/dean'?s research fellowship|rosenfeld/.test(identityLower)) {
    return {
      ...baseFundingClassification(),
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep: 'Confirm mentor and project fit before applying for summer research funding.',
      prepSteps: ['Faculty mentor', 'Research proposal', 'Official application'],
    };
  }

  if (
    SENIOR_RESEARCH_NAME.test(identityLower) ||
    proseFundsSeniorResearch(proseForProgram(input).toLowerCase())
  ) {
    return {
      ...baseFundingClassification(),
      programKind: 'SENIOR_THESIS_FUNDING',
      studentFacingCategory: 'Senior research funding',
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      bestNextStep: 'Use this record after you have a senior project, adviser, or research plan.',
      prepSteps: ['Adviser or sponsor', 'Senior project plan', 'Budget or proposal'],
    };
  }

  const isReuOrSummerResearchProgram =
    /research experiences? for undergraduates|\bnsf reu\b|\breu\b/.test(lower) ||
    /\bsummer (?:undergraduate )?research (?:program|scholars?(?:hip)?)\b/.test(lower) ||
    /\bsummer scholars program\b/.test(lower);
  if (isReuOrSummerResearchProgram) {
    const mentorFirst =
      /(?:identify|secure|arrange|line up|obtain|find)[^.]{0,80}(?:faculty |research )?(?:mentor|adviser|advisor|sponsor)[^.]{0,80}(?:before|prior to|ahead of)\b/.test(
        lower,
      ) ||
      /must (?:first )?(?:identify|secure|arrange|have|contact)[^.]{0,40}(?:faculty )?(?:mentor|adviser|advisor)\b/.test(
        lower,
      );
    return structuredProgram({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: mentorFirst ? 'STRUCTURED_PROGRAM' : 'MENTOR_MATCHING',
      entryMode: mentorFirst ? 'SECURE_MENTOR_THEN_APPLY' : 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Summer research program (REU)',
      requiresMentorBeforeApply: mentorFirst,
      mentorMatching: !mentorFirst,
      undergraduateOnly: true,
      programDates: 'Summer',
      bestNextStep: mentorFirst
        ? 'Identify a Yale faculty mentor in the program area, then apply to the summer research program.'
        : 'Apply to the summer research program; admitted students are matched with a Yale faculty mentor.',
      prepSteps: mentorFirst
        ? ['Faculty mentor', 'Research interests', 'Official application']
        : ['Research interests', 'Official application'],
    });
  }

  const funding = fundingClassificationFromPage(input);
  if (/not for undergraduates|graduate students only|doctoral dissertation/.test(lower)) {
    return archiveReviewClassification();
  }

  if (namesInternshipProgram(input)) {
    const runByDepartment = publishedOnDepartmentPage(input);
    return structuredProgram({
      programCategory: runByDepartment ? 'RECURRING_PROGRAM' : 'CENTER_INTERNSHIP',
      programKind: runByDepartment ? 'STRUCTURED_PROGRAM' : 'CENTER_INTERNSHIP',
      studentFacingCategory: 'Internship program',
      bestNextStep: 'Review the official internship page and application requirements.',
      prepSteps: ['Eligibility check', 'Official application'],
    });
  }

  // An award that requires or funds work with a faculty mentor is still an award: the
  // generic mentor wording otherwise filed research and travel awards as mentored programs.
  if (
    /mentor match|matched with|faculty mentor|cohort|training program/.test(lower) &&
    !AWARD_INSTRUMENT_TITLE.test(titleLower)
  ) {
    return structuredProgram({
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Mentored program',
      mentorMatching: true,
      bestNextStep: 'Apply through the program and prepare a concise research-interest statement.',
      prepSteps: ['Research interests', 'Official application'],
    });
  }

  if (/research assistant|\bra program|\bra\b/.test(lower)) {
    return structuredProgram({
      programKind: 'RA_PROGRAM',
      entryMode: 'APPLY_TO_PROJECT',
      studentFacingCategory: 'Research assistant program',
      bestNextStep: 'Find a project that fits your interests and apply through the official route.',
      prepSteps: ['Project fit', 'Official application'],
    });
  }

  if (/travel|abroad|field research/.test(lower) && /\bresearch|\bfieldwork\b/.test(lower)) {
    return {
      ...funding,
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Research travel funding',
      prepSteps: funding.requiresMentorBeforeApply
        ? ['Research plan', 'Budget', 'Faculty sponsor', 'Official application']
        : ['Research plan', 'Budget', 'Official application'],
    };
  }

  if (!title) {
    return {
      programCategory: 'FELLOWSHIP',
      programKind: 'OTHER',
      entryMode: 'UNKNOWN',
      studentFacingCategory: 'Program record',
      requiresMentorBeforeApply: false,
      mentorMatching: false,
      bestNextStep: 'Review the official source before acting on this record.',
      prepSteps: ['Official source review'],
    };
  }

  return funding;
}

export function classifyProgram(input: ProgramClassificationInput): ProgramClassification {
  const classification = classifyProgramKind(input);
  return { ...classification, programRole: programRoleForKind(classification.programKind) };
}
