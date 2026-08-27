/**
 * Types for the research detail page payload (`GET /api/research/:slug`).
 *
 * The server returns canonical `researchEntity` detail data, along
 * with denormalized member info, curated scholarly activity, and active listings. The UI
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
  | 'alumni'
  | 'postdoc'
  | 'grad-student'
  | 'undergrad'
  | 'staff'
  | 'affiliate';

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
  website?: string;
  websiteUrl?: string;
  title?: string;
}

export interface LabMember {
  user: LabMemberUser;
  role: LabMemberRole;
  rosterEvidence?: {
    sourceUrl?: string;
    profileUrl?: string;
    observedAt?: string;
    freshnessExpiresAt?: string;
  };
}

export interface LabRosterDisclosure {
  status: 'current' | 'partial' | 'no-verified-data' | 'withheld' | 'optional-source-failure';
  returned: number;
  truncated: boolean;
  withheldCount: number;
  sourceUrl?: string;
  observedAt?: string;
  freshnessExpiresAt?: string;
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

export interface LabAccessSignal {
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: string;
}

export type UndergraduateLogisticsClaimType =
  | 'STUDENT_LEVEL'
  | 'COMPENSATION'
  | 'TIME_COMMITMENT'
  | 'MODALITY'
  | 'CURRENT_AVAILABILITY';

export type UndergraduateLogisticsClaimState =
  | 'known'
  | 'unknown'
  | 'stale_under_review'
  | 'conflicting_withheld';

export interface UndergraduateLogisticsClaim {
  claimType: UndergraduateLogisticsClaimType;
  state: UndergraduateLogisticsClaimState;
  value?: {
    levels?: string[];
    modes?: string[];
    minHours?: number;
    maxHours?: number;
    period?: 'WEEK';
    status?: string;
  };
  evidence?: {
    sourceUrl: string;
    excerpt: string;
    observedAt: string;
    expiresAt: string;
  };
}

export interface UndergraduateLogisticsPayload {
  status: 'ready' | 'unavailable';
  claims: UndergraduateLogisticsClaim[];
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

export interface LabRelatedResearchEntitySummary {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  blurb?: string;
}

export interface LabRelationshipCollectionMeta {
  returned: number;
  truncated: boolean;
}

export interface LabDetailPayload {
  group: ResearchGroup;
  researchEntity?: ResearchEntity;
  members: LabMember[];
  roster?: LabRosterDisclosure;
  researchActivityLinks?: LabResearchActivityLink[];
  earlierResearchActivityLinks?: LabResearchActivityLink[];
  scholarlyLinks?: LabScholarlyLink[];
  memberScholarlyLinks?: LabScholarlyLink[];
  activeListings: Listing[];
  accessSignals?: LabAccessSignal[];
  undergraduateLogistics?: UndergraduateLogisticsPayload;
  entityRelationships?: LabEntityRelationship[];
  relatedResearchEntities?: LabRelatedResearchEntitySummary[];
  relatedResearchEntitiesMeta?: LabRelationshipCollectionMeta;
  affiliatedRelationships?: LabEntityRelationship[];
  affiliatedResearchEntities?: LabRelatedResearchEntitySummary[];
  affiliatedResearchEntitiesMeta?: LabRelationshipCollectionMeta;
  similarResearchEntities?: LabRelatedResearchEntitySummary[];
}
