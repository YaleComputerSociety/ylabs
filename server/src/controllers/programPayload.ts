import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeCatalogDescription, stripRedactionPlaceholders } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import { isUnhelpfulProgramUrl } from '../utils/researchHomeWebsiteUrl';

const publicSpecificProgramUrl = (value: unknown, sourceUrl?: unknown): string | undefined => {
  const url = publicHttpUrl(value);
  if (!url || isUnhelpfulProgramUrl(url, sourceUrl)) return undefined;
  return url;
};

const publicProgramLinks = (
  links: unknown,
  sourceUrl?: unknown,
): Array<{ label?: string; url: string }> =>
  Array.isArray(links)
    ? links.flatMap((link) => {
        if (!link || typeof link !== 'object') return [];
        const record = link as Record<string, unknown>;
        const url = publicSpecificProgramUrl(record.url, sourceUrl);
        if (!url) return [];
        const label =
          typeof record.label === 'string' && record.label.trim()
            ? redactDirectContactInfo(record.label.trim())
            : undefined;
        return [{ ...(label ? { label } : {}), url }];
      })
    : [];

const publicProgramText = (value: unknown): unknown =>
  typeof value === 'string' ? redactDirectContactInfo(value) : value;

const publicProgramProse = (value: unknown): unknown =>
  typeof value === 'string' ? stripRedactionPlaceholders(redactDirectContactInfo(value)) : value;

const publicProgramDescription = (value: unknown): unknown =>
  typeof value === 'string'
    ? stripRedactionPlaceholders(redactDirectContactInfo(sanitizeCatalogDescription(value)))
    : value;

const publicProgramTextArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? [redactDirectContactInfo(item)] : []))
    : [];

export const publicProgramForReader = (program: any) => {
  const id = serializedDocumentId(program._id) || serializedDocumentId(program.id) || '';
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
    compensationSummary: publicProgramText(program.compensationSummary),
    hoursPerWeek: program.hoursPerWeek,
    programDates: publicProgramText(program.programDates),
    bestNextStep: publicProgramText(program.bestNextStep),
    prepSteps: publicProgramTextArray(program.prepSteps),
    researchFocused: program.researchFocused === true,
    applicationMaterials: publicProgramTextArray(program.applicationMaterials),
    title: publicProgramText(program.title),
    competitionType: publicProgramText(program.competitionType),
    summary: publicProgramDescription(program.summary),
    description: publicProgramDescription(program.description),
    applicationInformation: publicProgramProse(program.applicationInformation),
    eligibility: publicProgramProse(program.eligibility),
    restrictionsToUseOfAward: publicProgramText(program.restrictionsToUseOfAward),
    additionalInformation: publicProgramText(program.additionalInformation),
    links: publicProgramLinks(program.links, program.sourceUrl),
    applicationLink: publicSpecificProgramUrl(program.applicationLink, program.sourceUrl),
    awardAmount: program.awardAmount,
    isAcceptingApplications: program.isAcceptingApplications,
    applicationOpenDate: program.applicationOpenDate,
    deadline: program.deadline,
    contactOffice: publicProgramText(program.contactOffice),
    yearOfStudy: Array.isArray(program.yearOfStudy) ? program.yearOfStudy : [],
    termOfAward: Array.isArray(program.termOfAward) ? program.termOfAward : [],
    purpose: Array.isArray(program.purpose) ? program.purpose : [],
    globalRegions: Array.isArray(program.globalRegions) ? program.globalRegions : [],
    citizenshipStatus: Array.isArray(program.citizenshipStatus) ? program.citizenshipStatus : [],
    sourceName: publicProgramText(program.sourceName),
    sourceUrl: publicHttpUrl(program.sourceUrl),
  };
};
