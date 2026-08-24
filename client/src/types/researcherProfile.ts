import { ResearchEntity } from './researchEntity';

export interface ResearcherProfilePayload {
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  officialProfileUrl?: string;
  scholarUrl?: string;
  orcidUrl?: string;
  homes: ResearchEntity[];
}
