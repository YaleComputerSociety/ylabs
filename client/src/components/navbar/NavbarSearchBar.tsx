/**
 * Search bar component in the navbar for listings.
 */
import { useContext, useRef } from 'react';
import SearchContext from '../../contexts/SearchContext';

const NavbarSearchBar = () => {
  const { queryString, setQueryString } = useContext(SearchContext);
  const searchRef = useRef<HTMLInputElement | null>(null);

  return (
    <input
      ref={searchRef}
      type="text"
      value={queryString}
      onChange={(e) => setQueryString(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          searchRef.current?.blur();
        }
      }}
      placeholder="Search labs..."
      className="h-9 px-3 flex-1 min-w-[200px] border border-gray-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    />
  );
};

export default NavbarSearchBar;
