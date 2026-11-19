import SortMenu, { type SortDirection, type SortMenuOption } from '../shared/SortMenu';

export type ResearchSortField = 'relevance' | 'name' | 'lastObservedAt';

const BEST_MATCH_LABEL = 'Best match';
const MOST_COMPLETE_LABEL = 'Most complete profiles';

const sortOptionsFor = (hasQuery: boolean): readonly SortMenuOption<ResearchSortField>[] => [
  { value: 'relevance', label: hasQuery ? BEST_MATCH_LABEL : MOST_COMPLETE_LABEL },
  { value: 'name', label: 'Name' },
  { value: 'lastObservedAt', label: 'Recently updated' },
];

interface ResearchSortDropdownProps {
  sortBy: ResearchSortField;
  sortOrder: SortDirection;
  hasQuery: boolean;
  onSortByChange: (value: ResearchSortField) => void;
  onToggleSortDirection: () => void;
  inFilterBar?: boolean;
}

const ResearchSortDropdown = ({
  sortBy,
  sortOrder,
  hasQuery,
  onSortByChange,
  onToggleSortDirection,
  inFilterBar = false,
}: ResearchSortDropdownProps) => (
  <SortMenu
    subject="research"
    options={sortOptionsFor(hasQuery)}
    value={sortBy}
    directionlessValue="relevance"
    sortDirection={sortOrder}
    onChange={onSortByChange}
    onToggleSortDirection={onToggleSortDirection}
    shortLabelOnPhone={inFilterBar}
    menuAlign={inFilterBar ? 'end' : 'start'}
  />
);

export default ResearchSortDropdown;
