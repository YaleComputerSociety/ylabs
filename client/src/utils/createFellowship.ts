/**
 * Fellowship creation API helper.
 */
import { Fellowship } from '../types/types';

export function createFellowship(data: any): Fellowship {
  return {
    id: data._id || data.id,
    title: data.title || '',
    competitionType: data.competitionType || '',
    summary: data.summary || '',
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
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
    contactOffice: data.contactOffice || '',
    yearOfStudy: data.yearOfStudy || [],
    termOfAward: data.termOfAward || [],
    purpose: data.purpose || [],
    globalRegions: data.globalRegions || [],
    citizenshipStatus: data.citizenshipStatus || [],
    archived: data.archived || false,
    audited: data.audited || false,
    views: data.views || 0,
    favorites: data.favorites || 0,
    updatedAt: data.updatedAt || '',
    createdAt: data.createdAt || '',
  };
}
