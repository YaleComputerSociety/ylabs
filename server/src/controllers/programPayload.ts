import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  sanitizeCatalogDescription,
  stripRedactionPlaceholders,
} from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { humanizeProgramLinkLabel } from '../utils/programLinkLabel';
import { publicHttpUrl } from '../utils/urlSafety';
import { isUnhelpfulProgramUrl } from '../utils/researchHomeWebsiteUrl';

const MAX_PROGRAM_LINKS = 8;

const CHROME_LINK_LABEL =
  /^(?:accessibility|privacy(?:\s+policy)?|terms(?:\s+(?:of\s+(?:use|service)|and\s+conditions))?|give(?:\s+back|\s+now)?|giving|donate|make\s+a\s+gift|contact(?:\s+us)?|sitemap|site\s+map|faculty\s+(?:directory|openings|positions)|campus\s+life|social\s+media|our\s+mantra|log\s+in|sign\s+in|search)$/i;

const isChromeLinkLabel = (label: string): boolean => {
  const normalized = label
    .replace(/\s*[>›»]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (/\boverview$/i.test(normalized)) return true;
  return CHROME_LINK_LABEL.test(normalized);
};

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
    ? links
        .flatMap((link) => {
          if (!link || typeof link !== 'object') return [];
          const record = link as Record<string, unknown>;
          const rawLabel =
            typeof record.label === 'string' && record.label.trim()
              ? record.label.trim()
              : undefined;
          if (rawLabel && isChromeLinkLabel(rawLabel)) return [];
          const url = publicSpecificProgramUrl(record.url, sourceUrl);
          if (!url) return [];
          const humanLabel = humanizeProgramLinkLabel(rawLabel, url);
          const label = humanLabel ? redactDirectContactInfo(humanLabel) : undefined;
          return [{ ...(label ? { label } : {}), url }];
        })
        .slice(0, MAX_PROGRAM_LINKS)
    : [];

const publicProgramText = (value: unknown): unknown =>
  typeof value === 'string' ? redactDirectContactInfo(value) : value;

const publicProgramDescription = (value: unknown): unknown =>
  typeof value === 'string'
    ? stripRedactionPlaceholders(sanitizeCatalogDescription(redactDirectContactInfo(value)))
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
    compensationSummary: publicProgramDescription(program.compensationSummary),
    hoursPerWeek: program.hoursPerWeek,
    programDates: publicProgramText(program.programDates),
    bestNextStep: publicProgramDescription(program.bestNextStep),
    prepSteps: publicProgramTextArray(program.prepSteps),
    researchFocused: program.researchFocused === true,
    applicationMaterials: publicProgramTextArray(program.applicationMaterials),
    title: publicProgramText(program.title),
    competitionType: publicProgramText(program.competitionType),
    summary: publicProgramDescription(program.summary),
    description: publicProgramDescription(program.description),
    applicationInformation: publicProgramDescription(program.applicationInformation),
    eligibility: publicProgramDescription(program.eligibility),
    restrictionsToUseOfAward: publicProgramDescription(program.restrictionsToUseOfAward),
    additionalInformation: publicProgramDescription(program.additionalInformation),
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
