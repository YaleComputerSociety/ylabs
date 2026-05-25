import type { ProgramCategory, ProgramEntryMode, ProgramKind } from '../models/fellowship';

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

function baseFundingClassification(): ProgramClassification {
  return {
    programCategory: 'FELLOWSHIP',
    programKind: 'FELLOWSHIP_FUNDING',
    entryMode: 'SECURE_MENTOR_THEN_APPLY',
    studentFacingCategory: 'Funding after mentor',
    requiresMentorBeforeApply: true,
    mentorMatching: false,
    bestNextStep: 'Identify a research home or mentor, then use this funding record to plan the application.',
    prepSteps: ['Research plan', 'Faculty mentor or sponsor', 'Official application'],
  };
}

function archiveReviewClassification(): ProgramClassification {
  return {
    programCategory: 'FELLOWSHIP',
    programKind: 'OTHER',
    entryMode: 'TRACK_NEXT_CYCLE',
    studentFacingCategory: 'Archive / review',
    requiresMentorBeforeApply: false,
    mentorMatching: false,
    undergraduateOnly: false,
    bestNextStep: 'Review carefully before relying on this record; it may not be an undergraduate option.',
    prepSteps: ['Eligibility check', 'Official source review'],
  };
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

  if (
    /not for undergraduates/.test(lower) ||
    (!hasUndergraduateAudience &&
      /graduate students only|doctoral students?|doctoral dissertation|graduate research assistantships?|graduate and professional(?: school)? students?|master'?s students?|masters students?|phd students?|phd dissertations?|yale university graduate students|postgraduate study|yls graduates|graduate school of arts & sciences|historians, medical practitioners, and other researchers outside of yale|yale law school/.test(
        lower,
      ))
  ) {
    return archiveReviewClassification();
  }

  if (/\btobin\b/.test(lower) && /\bresearch assistant/i.test(text)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'RA_PROGRAM',
      entryMode: 'APPLY_TO_PROJECT',
      studentFacingCategory: 'Project posting',
      compensationSummary: '$17/hour when source-confirmed',
      hoursPerWeek: 10,
      bestNextStep: 'Choose a posted faculty project and apply through the Tobin RA process.',
      prepSteps: ['Project selection', 'Resume or short application', 'Faculty project fit'],
    });
  }

  if (/\bstars\b/.test(lower) && /\bsummer research program\b/.test(lower)) {
    return structuredProgram({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Structured summer program',
      requiresMentorBeforeApply: true,
      compensationSummary: 'Stipend plus housing/board when source-confirmed',
      programDates: 'Summer',
      bestNextStep: 'Secure a Yale lab commitment before applying.',
      prepSteps: ['Yale lab commitment', 'Research proposal', 'Mentor support', 'Official application'],
    });
  }

  if (/\bwu tsai\b|\bwti\.yale\.edu\b/.test(lower)) {
    return structuredProgram({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Mentored summer program',
      mentorMatching: true,
      compensationSummary: 'Summer stipend when source-confirmed',
      programDates: 'Summer',
      bestNextStep: 'Apply to the Wu Tsai undergraduate fellowship and identify possible mentors if listed.',
      prepSteps: ['Interest statement', 'Potential mentor fit', 'Official application'],
    });
  }

  if (/\bwomen'?s health research\b|\bwhr\b/.test(lower)) {
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

  if (/\bycmd\b|center for molecular discovery|summer undergraduate internships/.test(lower)) {
    return structuredProgram({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Center internship',
      compensationSummary: 'Paid internship when source-confirmed',
      programDates: 'Summer',
      bestNextStep: 'Apply to the center internship and check project fit.',
      prepSteps: ['Official application', 'Project interest', 'Summer availability'],
    });
  }

  if (/computer science research internship|cs research internship/.test(lower)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      studentFacingCategory: 'Faculty matching program',
      mentorMatching: true,
      bestNextStep: 'Apply to the CS research internship so the committee can consider faculty matches.',
      prepSteps: ['Research interests', 'Relevant coursework', 'Official application'],
    });
  }

  if (/mellon mays/.test(lower)) {
    return structuredProgram({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'APPLY_TO_PROGRAM',
      studentFacingCategory: 'Cohort research program',
      mentorMatching: true,
      compensationSummary: 'Academic-year and summer research support when source-confirmed',
      bestNextStep: 'Review Mellon Mays eligibility and prepare the cohort-program application.',
      prepSteps: ['Faculty mentor fit', 'Research interests', 'Official application'],
    });
  }

  if (/first[- ]year summer research fellowship/.test(lower)) {
    return {
      ...baseFundingClassification(),
      studentFacingCategory: 'Funding after mentor',
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep: 'Find a Yale faculty mentor and prepare a proposed summer research project before applying.',
      prepSteps: ['Faculty mentor', 'Project proposal', 'Mentor letter', 'Official application'],
    };
  }

  if (/tetelman|bates/.test(lower)) {
    return {
      ...baseFundingClassification(),
      programKind: 'TRAVEL_RESEARCH_GRANT',
      studentFacingCategory: 'Research travel funding',
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep: 'Develop an independent research plan and faculty support before applying for travel funding.',
      prepSteps: ['Independent research plan', 'Faculty support', 'Budget', 'Official application'],
    };
  }

  if (/dean'?s research fellowship|rosenfeld/.test(lower)) {
    return {
      ...baseFundingClassification(),
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      programDates: 'Summer',
      bestNextStep: 'Confirm mentor and project fit before applying for summer research funding.',
      prepSteps: ['Faculty mentor', 'Research proposal', 'Official application'],
    };
  }

  if (/senior (?:research|essay)|senior project|mellon senior|residential college|richter/.test(lower)) {
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
