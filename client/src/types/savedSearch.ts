export interface SavedSearchFilters {
  school: string[];
  departments: string[];
  researchAreas: string[];
  entityType: string[];
  currentAvailability: Array<'OPEN' | 'ROLLING'>;
  compensation: Array<'PAID_OR_STIPEND' | 'COURSE_CREDIT'>;
  hostsUndergrads: boolean;
  hasDocumentedWayIn: boolean;
}

export interface SavedSearchView {
  _id: string;
  label: string;
  queryText: string;
  filters: SavedSearchFilters;
  urlParams: string;
  newMatchCount: number | null;
  lastViewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SavedSearchSavePayload {
  label?: string;
  queryText: string;
  filters: SavedSearchFilters;
  urlParams: string;
}
