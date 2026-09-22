import type { ProgramCategory, ProgramEntryMode, ProgramKind } from '../models/fellowship';
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

function identityTextForProgram(input: ProgramClassificationInput): string {
  return [input.title, input.competitionType, input.sourceUrl]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function baseFundingClassification(): ProgramClassification {
  return {
    programCategory: 'FELLOWSHIP',
    programKind: 'FELLOWSHIP_FUNDING',
    entryMode: 'SECURE_MENTOR_THEN_APPLY',
    studentFacingCategory: 'Funding after mentor',
    requiresMentorBeforeApply: true,
    mentorMatching: false,
    bestNextStep:
      'Identify a research home or mentor, then use this funding record to plan the application.',
    prepSteps: ['Research plan', 'Faculty mentor or sponsor', 'Official application'],
  };
}

export const ARCHIVE_REVIEW_STUDENT_FACING_CATEGORY = 'Archive / review';

function archiveReviewClassification(): ProgramClassification {
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

function graduateResearchClassification(lower: string): ProgramClassification {
  const base: ProgramClassification = {
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

function structuredProgram(overrides: Partial<ProgramClassification>): ProgramClassification {
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

export function classifyProgram(input: ProgramClassificationInput): ProgramClassification {
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

  if (/\bstars\b/.test(identityLower) && /\bsummer research program\b/.test(lower)) {
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

  if (/mellon mays/.test(identityLower)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Cohort research program',
      mentorMatching: true,
      compensationSummary: 'Academic-year and summer research support',
      bestNextStep: 'Review Mellon Mays eligibility and prepare the cohort-program application.',
      prepSteps: ['Faculty mentor fit', 'Research interests', 'Official application'],
    });
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
    /senior (?:research|essay)|senior project|mellon senior|residential college|richter/.test(
      identityLower,
    )
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
    /\bsummer (?:undergraduate )?research (?:program|scholars?(?:hip)?)\b/.test(lower);
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

  const funding = baseFundingClassification();
  if (/not for undergraduates|graduate students only|doctoral dissertation/.test(lower)) {
    return archiveReviewClassification();
  }

  if (/internship|internships/.test(lower)) {
    return structuredProgram({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      studentFacingCategory: 'Internship program',
      bestNextStep: 'Review the official internship page and application requirements.',
      prepSteps: ['Eligibility check', 'Official application'],
    });
  }

  if (/mentor match|matched with|faculty mentor|cohort|training program/.test(lower)) {
    return structuredProgram({
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Mentored program',
      mentorMatching: true,
      bestNextStep: 'Apply through the program and prepare a concise research-interest statement.',
      prepSteps: ['Research interests', 'Official application'],
    });
  }

  if (/research assistant|ra program|ra\b/.test(lower)) {
    return structuredProgram({
      programKind: 'RA_PROGRAM',
      entryMode: 'APPLY_TO_PROJECT',
      studentFacingCategory: 'Research assistant program',
      bestNextStep: 'Find a project that fits your interests and apply through the official route.',
      prepSteps: ['Project fit', 'Official application'],
    });
  }

  if (/travel|abroad|field research/.test(lower)) {
    return {
      ...funding,
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Research travel funding',
      prepSteps: ['Research plan', 'Budget', 'Faculty sponsor', 'Official application'],
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
