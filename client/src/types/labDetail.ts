/**
 * Types for the research detail page payload (`GET /api/research/:slug`).
 *
 * The server returns the ResearchGroup plus a denormalized member list (with
 * embedded user info), recent papers, and active listings. The UI consumes
 * those collections directly — no further joins on the client.
 */
import { Listing } from './types';
import { ResearchGroup } from './researchGroup';

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
  doi?: string;
  citationCount?: number;
  publishedAt?: string;
}

export interface LabDetailPayload {
  group: ResearchGroup;
  members: LabMember[];
  recentPapers: LabPaper[];
  activeListings: Listing[];
}
