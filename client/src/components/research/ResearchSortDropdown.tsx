import SortMenu, { type SortDirection, type SortMenuOption } from '../shared/SortMenu';

export type ResearchSortField = 'relevance' | 'name' | 'lastObservedAt';

const sortOptions: readonly SortMenuOption<ResearchSortField>[] = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'name', label: 'Name' },
  { value: 'lastObservedAt', label: 'Recently updated' },
];

interface ResearchSortDropdownProps {
  sortBy: ResearchSortField;
  sortOrder: SortDirection;
  onSortByChange: (value: ResearchSortField) => void;
  onToggleSortDirection: () => void;
}

const ResearchSortDropdown = ({
  sortBy,
  sortOrder,
  onSortByChange,
  onToggleSortDirection,
}: ResearchSortDropdownProps) => (
  <SortMenu
    subject="research"
    options={sortOptions}
    value={sortBy}
    directionlessValue="relevance"
    sortDirection={sortOrder}
    onChange={onSortByChange}
    onToggleSortDirection={onToggleSortDirection}
  />
);

export default ResearchSortDropdown;
