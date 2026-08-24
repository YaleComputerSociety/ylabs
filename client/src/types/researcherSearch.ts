export interface ResearcherSearchHit {
  id: string;
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  homeCount: number;
}

export interface ResearcherSearchResponse {
  hits: ResearcherSearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}
