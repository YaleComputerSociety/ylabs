/**
 * Fellowship creation API helper.
 */
import { Fellowship, PROGRAM_AUDIENCES, type ProgramAudience } from '../types/types';

const programAudienceOf = (value: unknown): ProgramAudience | null =>
  (PROGRAM_AUDIENCES as readonly unknown[]).includes(value) ? (value as ProgramAudience) : null;

export function createFellowship(data: any): Fellowship {
  return {
    id: data._id || data.id,
    programCategory: data.programCategory || 'FELLOWSHIP',
    programKind: data.programKind || 'OTHER',
    programRole: data.programRole || undefined,
    entryMode: data.entryMode || 'UNKNOWN',
    studentFacingCategory: data.studentFacingCategory || '',
    requiresMentorBeforeApply: data.requiresMentorBeforeApply || false,
    mentorMatching: data.mentorMatching || false,
    undergraduateOnly: typeof data.undergraduateOnly === 'boolean' ? data.undergraduateOnly : null,
    yaleCollegeOnly: typeof data.yaleCollegeOnly === 'boolean' ? data.yaleCollegeOnly : null,
    audience: programAudienceOf(data.audience),
    compensationSummary: data.compensationSummary || '',
    hoursPerWeek: typeof data.hoursPerWeek === 'number' ? data.hoursPerWeek : null,
    programDates: data.programDates || '',
    bestNextStep: data.bestNextStep || '',
    prepSteps: data.prepSteps || [],
    title: data.title || '',
    competitionType: data.competitionType || '',
    summary: data.summary || '',
    cardSummary: typeof data.cardSummary === 'string' ? data.cardSummary : undefined,
    description: data.description || '',
    applicationInformation: data.applicationInformation || '',
    eligibility: data.eligibility || '',
    restrictionsToUseOfAward: data.restrictionsToUseOfAward || '',
    additionalInformation: data.additionalInformation || '',
    links: data.links || [],
    applicationLink: data.applicationLink || '',
    awardAmount: data.awardAmount || '',
    isAcceptingApplications: data.isAcceptingApplications || false,
    applicationOpenDate: data.applicationOpenDate || null,
    deadline: data.deadline || null,
    // The server projects a recurring deadline forward and flags it (#1368). Dropping the
    // flag here made every consumer read a projected date as a live window, so a browse card
    // showed a green "Open" pill for next year's estimate and the detail modal suppressed its
    // own "unconfirmed, verify at source" warning (#3904).
    deadlineProjectedNextCycle: data.deadlineProjectedNextCycle === true,
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
    contactOffice: data.contactOffice || '',
    yearOfStudy: data.yearOfStudy || [],
    termOfAward: data.termOfAward || [],
    purpose: data.purpose || [],
    globalRegions: data.globalRegions || [],
    citizenshipStatus: data.citizenshipStatus || [],
    sourceName: data.sourceName || '',
    sourceUrl: data.sourceUrl || '',
    sourceLinkHealth: data.sourceLinkHealth || undefined,
    sourceKey: data.sourceKey || '',
    sourceFingerprint: data.sourceFingerprint || '',
    sourceLastVerifiedAt: data.sourceLastVerifiedAt || null,
    sourceLastChangedAt: data.sourceLastChangedAt || null,
    studentVisibilityTier: data.studentVisibilityTier,
    studentVisibilityComputedTier: data.studentVisibilityComputedTier,
    studentVisibilityOverrideTier: data.studentVisibilityOverrideTier,
    studentVisibilityReasons: data.studentVisibilityReasons || [],
    studentVisibilitySuppressionReason: data.studentVisibilitySuppressionReason || '',
    archived: data.archived || false,
    audited: data.audited || false,
    views: data.views || 0,
    favorites: data.favorites || 0,
    updatedAt: data.updatedAt || '',
    createdAt: data.createdAt || '',
  };
}
