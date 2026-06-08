import { redactDirectContactInfo } from '../utils/contactRedaction';
import { publicContactEmail } from '../utils/contactEmail';
import { publicHttpUrl } from '../utils/urlSafety';

const publicProgramLinks = (links: unknown): Array<{ label?: string; url: string }> =>
  Array.isArray(links)
    ? links.flatMap((link) => {
        if (!link || typeof link !== 'object') return [];
        const record = link as Record<string, unknown>;
        const url = publicHttpUrl(record.url);
        if (!url) return [];
        const label = typeof record.label === 'string' && record.label.trim()
          ? redactDirectContactInfo(record.label.trim())
          : undefined;
        return [{ ...(label ? { label } : {}), url }];
      })
    : [];

export const publicProgramForReader = (program: any) => {
  const id = program._id?.toString?.() || program._id || program.id;
  return {
    _id: id,
    id,
    programCategory: program.programCategory,
    programKind: program.programKind,
    entryMode: program.entryMode,
    studentFacingCategory: program.studentFacingCategory,
    requiresMentorBeforeApply: program.requiresMentorBeforeApply,
    mentorMatching: program.mentorMatching,
    undergraduateOnly: program.undergraduateOnly,
    yaleCollegeOnly: program.yaleCollegeOnly,
    compensationSummary: program.compensationSummary,
    hoursPerWeek: program.hoursPerWeek,
    programDates: program.programDates,
    bestNextStep: program.bestNextStep,
    prepSteps: Array.isArray(program.prepSteps) ? program.prepSteps : [],
    title: program.title,
    competitionType: program.competitionType,
    summary: program.summary,
    description: program.description,
    applicationInformation: program.applicationInformation,
    eligibility: program.eligibility,
    restrictionsToUseOfAward: program.restrictionsToUseOfAward,
    additionalInformation: program.additionalInformation,
    links: publicProgramLinks(program.links),
    applicationLink: publicHttpUrl(program.applicationLink),
    awardAmount: program.awardAmount,
    isAcceptingApplications: program.isAcceptingApplications,
    applicationOpenDate: program.applicationOpenDate,
    deadline: program.deadline,
    contactName: program.contactName,
    contactEmail: publicContactEmail(program.contactEmail),
    contactPhone: program.contactPhone,
    contactOffice: program.contactOffice,
    yearOfStudy: Array.isArray(program.yearOfStudy) ? program.yearOfStudy : [],
    termOfAward: Array.isArray(program.termOfAward) ? program.termOfAward : [],
    purpose: Array.isArray(program.purpose) ? program.purpose : [],
    globalRegions: Array.isArray(program.globalRegions) ? program.globalRegions : [],
    citizenshipStatus: Array.isArray(program.citizenshipStatus) ? program.citizenshipStatus : [],
    sourceName: program.sourceName,
    sourceUrl: publicHttpUrl(program.sourceUrl),
    studentVisibilityTier: program.studentVisibilityTier,
    studentVisibilityComputedTier: program.studentVisibilityComputedTier,
    studentVisibilityReasons: Array.isArray(program.studentVisibilityReasons)
      ? program.studentVisibilityReasons
      : [],
    createdAt: program.createdAt,
    updatedAt: program.updatedAt,
  };
};
