/**
 * Types for the research detail page payload (`GET /api/research/:slug`).
 *
 * The server returns canonical `researchEntity` detail data, along
 * with denormalized member info, recent papers, and active listings. The UI
 * consumes those collections directly — no further joins on the client.
 */
import { Listing } from './types';
import { ResearchEntity, ResearchGroup } from './researchGroup';

export type LabMemberRole =
  | 'pi'
  | 'co-pi'
  | 'director'
  | 'co-director'
  | 'core-faculty'
  | 'affiliated'
  | 'alumni';

export interface LabMemberUser {
  netid: string;
  fname: string;
  lname: string;
  image_url?: string;
  primary_department?: string;
  title?: string;
  email?: string;
}

export interface LabMember {
  user: LabMemberUser;
  role: LabMemberRole;
}

export interface LabPaper {
  _id: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  tldr?: string;
  url?: string;
  openAccessUrl?: string;
  landingPageUrl?: string;
  pdfUrl?: string;
  arxivId?: string;
  doi?: string;
  citationCount?: number;
  publishedAt?: string;
  postedAt?: string;
  versionDate?: string;
  publicationStage?: string;
  preprintServer?: string;
}

export interface LabEntryPathway {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength?: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: string;
  sourceUrls?: string[];
  confidence?: number;
}

export interface LabAccessSignal {
  _id: string;
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: string;
}

export interface LabContactRoute {
  _id: string;
  routeType: string;
  label?: string;
  name?: string;
  role?: string;
  email?: string;
  url?: string;
  priority?: number;
  visibility?: string;
  contactPolicy?: string;
  rationale?: string;
  sourceUrl?: string;
}

export interface LabPostedOpportunity {
  _id: string;
  entryPathwayId: string;
  listingId?: string;
  title: string;
  term?: string;
  deadline?: string;
  applicationUrl?: string;
  status: string;
  sourceUrls?: string[];
}

export interface LabDetailPayload {
  group: ResearchGroup;
  researchEntity?: ResearchEntity;
  members: LabMember[];
  recentPapers: LabPaper[];
  recentArxivPreprints?: LabPaper[];
  activeListings: Listing[];
  entryPathways?: LabEntryPathway[];
  accessSignals?: LabAccessSignal[];
  contactRoutes?: LabContactRoute[];
  postedOpportunities?: LabPostedOpportunity[];
}
