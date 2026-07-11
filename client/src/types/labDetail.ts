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
  _id?: string;
  netid?: string;
  email?: string;
  publicKey?: string;
  fname: string;
  lname: string;
  displayName?: string;
  imageUrl?: string;
  image_url?: string;
  primaryDepartment?: string;
  primary_department?: string;
  profileUrls?: Record<string, string>;
  profile_urls?: Record<string, string>;
  internalProfilePath?: string;
  internal_profile_path?: string;
  website?: string;
  websiteUrl?: string;
  title?: string;
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

export interface LabScholarlyLink {
  _id: string;
  memberKey?: string;
  title: string;
  url: string;
  destinationKind:
    | 'DOI'
    | 'PUBLISHER'
    | 'PUBMED'
    | 'PMC'
    | 'ARXIV'
    | 'ORCID'
    | 'OPENALEX'
    | 'OFFICIAL_PROFILE'
    | 'OTHER';
  displaySource: string;
  freeFullTextUrl?: string;
  freeFullTextLabel?: string;
  openAccessStatus?: string;
  discoveredVia: 'OPENALEX' | 'ORCID' | 'OFFICIAL_PROFILE' | 'MANUAL';
  year?: number;
  venue?: string;
  confidence?: number;
  observedAt?: string;
  externalIds?: {
    doi?: string;
    openAlexId?: string;
    arxivId?: string;
    pmid?: string;
    pmcid?: string;
  };
}

export type LabResearchActivityRelationshipBasis =
  | 'explicit_entity_link'
  | 'entity_source'
  | 'member_authorship'
  | 'identity_authorship'
  | 'manual';

export interface LabResearchActivityLink extends LabScholarlyLink {
  relationshipBasis: LabResearchActivityRelationshipBasis;
  evidenceLabel: string;
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
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: string;
}

export interface LabContactRoute {
  _id?: string;
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
  reviewStatus?: string;
}

export interface LabPostedOpportunity {
  _id: string;
  title: string;
  term?: string;
  deadline?: string;
  applicationUrl?: string;
  status: string;
  sourceUrls?: string[];
}

export interface LabEntityRelationship {
  relatedResearchEntityId?: string;
  relatedResearchEntitySlug?: string;
  relationshipType: string;
  label: string;
  evidenceStrength?: string;
  sourceUrl?: string;
  evidenceQuote?: string;
  confidence?: number;
}

export interface LabDetailPayload {
  group: ResearchGroup;
  researchEntity?: ResearchEntity;
  members: LabMember[];
  researchActivityLinks?: LabResearchActivityLink[];
  earlierResearchActivityLinks?: LabResearchActivityLink[];
  scholarlyLinks?: LabScholarlyLink[];
  memberScholarlyLinks?: LabScholarlyLink[];
  recentPapers: LabPaper[];
  recentArxivPreprints?: LabPaper[];
  activeListings: Listing[];
  entryPathways?: LabEntryPathway[];
  accessSignals?: LabAccessSignal[];
  contactRoutes?: LabContactRoute[];
  postedOpportunities?: LabPostedOpportunity[];
  entityRelationships?: LabEntityRelationship[];
  relatedResearchEntities?: ResearchEntity[];
  affiliatedRelationships?: LabEntityRelationship[];
  affiliatedResearchEntities?: ResearchEntity[];
}
