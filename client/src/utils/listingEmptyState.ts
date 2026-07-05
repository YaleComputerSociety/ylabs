export type ListingSearchCriteria = {
  queryString: string;
  selectedDepartments: string[];
  selectedResearchAreas: string[];
  selectedListingResearchAreas: string[];
  quickFilter: string | null;
};

export const hasListingSearchCriteria = (params: ListingSearchCriteria) =>
  params.queryString.trim() !== '' ||
  params.selectedDepartments.length > 0 ||
  params.selectedResearchAreas.length > 0 ||
  params.selectedListingResearchAreas.length > 0 ||
  Boolean(params.quickFilter);

export const getListingEmptyMessage = (params: ListingSearchCriteria) => {
  return hasListingSearchCriteria(params)
    ? 'No labs match your current search or filters'
    : 'No research labs are available right now';
};
