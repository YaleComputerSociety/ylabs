import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  sanitizeCatalogDescription,
  stripRedactionPlaceholders,
} from '../utils/descriptionHygiene';
import { stripProvenanceHedge } from '../utils/provenanceHedge';
import { serializedDocumentId } from '../utils/idSerialization';
import { humanizeProgramLinkLabel } from '../utils/programLinkLabel';
import { publicHttpUrl } from '../utils/urlSafety';
import { isUnhelpfulProgramUrl } from '../utils/researchHomeWebsiteUrl';
import { classifyProgram } from '../services/programClassifier';
import { fellowshipClassificationInput } from '../scrapers/fellowshipClassificationDerivation';
import { programAudience } from '../services/programAudience';
import { isDepartmentResearchGuidance } from '../services/departmentResearchGuidance';

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

export const publicProgramDescription = (value: unknown): unknown =>
  typeof value === 'string'
    ? stripRedactionPlaceholders(sanitizeCatalogDescription(redactDirectContactInfo(value)))
    : value;

const publicCompensationSummary = (value: unknown): unknown => {
  const cleaned = publicProgramDescription(value);
  return typeof cleaned === 'string' ? stripProvenanceHedge(cleaned) : cleaned;
};

const publicProgramTextArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? [redactDirectContactInfo(item)] : []))
    : [];

const publicBestNextStep = (program: any): unknown => {
  const stored = publicProgramDescription(program.bestNextStep);
  if (typeof stored === 'string' && stored.trim()) return stored;
  const hadStoredText =
    typeof program.bestNextStep === 'string' && program.bestNextStep.trim().length > 0;
  if (hadStoredText) return stored;
  return publicProgramDescription(
    classifyProgram(fellowshipClassificationInput(program)).bestNextStep,
  );
};

interface PublicProgramSourceLinkHealth {
  url: string;
  healthStatus: string;
  httpStatusCode?: number;
}

const publicProgramSourceLinkHealth = (
  value: unknown,
): PublicProgramSourceLinkHealth | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const url = publicHttpUrl(record.url);
  const healthStatus = record.healthStatus;
  if (!url || typeof healthStatus !== 'string') return undefined;
  const httpStatusCode = record.httpStatusCode;
  return {
    url,
    healthStatus,
    ...(typeof httpStatusCode === 'number' && Number.isFinite(httpStatusCode)
      ? { httpStatusCode }
      : {}),
  };
};

export type ProgramReaderFieldGuard =
  | 'departmentResearchGuidance'
  | 'publicHttpUrl'
  | 'isUnhelpfulProgramUrl'
  | 'publicProgramDescription';

export interface ServedProgramReaderField<Value> {
  value: Value | undefined;
  withheldBy: ProgramReaderFieldGuard | null;
}

const nothingStored: ServedProgramReaderField<never> = { value: undefined, withheldBy: null };

const servedValue = <Value>(value: Value): ServedProgramReaderField<Value> => ({
  value,
  withheldBy: null,
});

const withheld = <Value>(guard: ProgramReaderFieldGuard): ServedProgramReaderField<Value> => ({
  value: undefined,
  withheldBy: guard,
});

const hasStoredText = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export const servedProgramApplicationLink = (program: any): ServedProgramReaderField<string> => {
  if (!hasStoredText(program?.applicationLink)) return nothingStored;
  if (program.departmentResearchGuidance === true) return withheld('departmentResearchGuidance');
  const url = publicHttpUrl(program.applicationLink);
  if (!url) return withheld('publicHttpUrl');
  if (isUnhelpfulProgramUrl(url, program.sourceUrl)) return withheld('isUnhelpfulProgramUrl');
  return servedValue(url);
};

export const servedProgramEligibility = (program: any): ServedProgramReaderField<unknown> => {
  const eligibility = publicProgramDescription(program?.eligibility);
  return hasStoredText(program?.eligibility) && !hasStoredText(eligibility)
    ? { value: eligibility, withheldBy: 'publicProgramDescription' }
    : servedValue(eligibility);
};

/**
 * Every reader field a serve-time guard can withhold. `publicProgramForReader` serves these
 * fields only through their decision, and the journey harness attributes a stored-to-served
 * difference by calling the same decision, so a new guard belongs inside the decision and
 * never inline in the payload (#4304).
 */
export const PROGRAM_READER_FIELD_DECISIONS = {
  applicationLink: servedProgramApplicationLink,
  eligibility: servedProgramEligibility,
} as const;

export type ProgramReaderDecidedField = keyof typeof PROGRAM_READER_FIELD_DECISIONS;

export const withProgramAudience = (program: any) =>
  program && typeof program === 'object'
    ? {
        ...program,
        audience: programAudience(program),
        departmentResearchGuidance: isDepartmentResearchGuidance(program),
      }
    : program;

export const publicProgramForReader = (program: any) => {
  const id = serializedDocumentId(program._id) || serializedDocumentId(program.id) || '';
  const departmentResearchGuidance = program.departmentResearchGuidance === true;
  return {
    _id: id,
    id,
    programCategory: program.programCategory,
    programKind: program.programKind,
    programRole: program.programRole,
    departmentResearchGuidance,
    entryMode: program.entryMode,
    studentFacingCategory: program.studentFacingCategory,
    requiresMentorBeforeApply: program.requiresMentorBeforeApply,
    mentorMatching: program.mentorMatching,
    undergraduateOnly: program.undergraduateOnly,
    yaleCollegeOnly: program.yaleCollegeOnly,
    audience: programAudience(program),
    compensationSummary: publicCompensationSummary(program.compensationSummary),
    hoursPerWeek: program.hoursPerWeek,
    programDates: publicProgramText(program.programDates),
    bestNextStep: publicBestNextStep(program),
    prepSteps: publicProgramTextArray(program.prepSteps),
    researchFocused: program.researchFocused === true,
    applicationMaterials: publicProgramTextArray(program.applicationMaterials),
    title: publicProgramText(program.title),
    competitionType: publicProgramText(program.competitionType),
    summary: publicProgramDescription(program.summary),
    cardSummary: publicProgramDescription(program.cardSummary),
    description: publicProgramDescription(program.description),
    applicationInformation: publicProgramDescription(program.applicationInformation),
    eligibility: servedProgramEligibility(program).value,
    restrictionsToUseOfAward: publicProgramDescription(program.restrictionsToUseOfAward),
    additionalInformation: publicProgramDescription(program.additionalInformation),
    links: publicProgramLinks(program.links, program.sourceUrl),
    applicationLink: servedProgramApplicationLink(program).value,
    awardAmount: program.awardAmount,
    isAcceptingApplications: program.isAcceptingApplications,
    applicationOpenDate: program.applicationOpenDate,
    deadline: program.deadline,
    deadlineProjectedNextCycle: program.deadlineProjectedNextCycle === true,
    contactOffice: publicProgramText(program.contactOffice),
    yearOfStudy: Array.isArray(program.yearOfStudy) ? program.yearOfStudy : [],
    termOfAward: Array.isArray(program.termOfAward) ? program.termOfAward : [],
    purpose: Array.isArray(program.purpose) ? program.purpose : [],
    globalRegions: Array.isArray(program.globalRegions) ? program.globalRegions : [],
    citizenshipStatus: Array.isArray(program.citizenshipStatus) ? program.citizenshipStatus : [],
    sourceName: publicProgramText(program.sourceName),
    sourceUrl: publicHttpUrl(program.sourceUrl),
    sourceLinkHealth: publicProgramSourceLinkHealth(program.sourceLinkHealth),
  };
};
