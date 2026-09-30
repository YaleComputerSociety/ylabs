import { useContext } from 'react';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import SortMenu, { type SortMenuOption } from './SortMenu';

const sortOptions: readonly SortMenuOption<string>[] = [
  { value: 'default', label: 'Recommended' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'title', label: 'Name' },
];

const FellowshipSortDropdown = () => {
  const { sortBy, setSortBy, sortDirection, onToggleSortDirection } =
    useContext(FellowshipSearchContext);

  return (
    <SortMenu
      subject="programs"
      options={sortOptions}
      value={sortBy}
      directionlessValue="default"
      sortDirection={sortDirection}
      onChange={setSortBy}
      onToggleSortDirection={onToggleSortDirection}
    />
  );
};

export default FellowshipSortDropdown;
