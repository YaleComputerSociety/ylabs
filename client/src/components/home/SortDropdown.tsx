interface SortOption {
  value: string;
  label: string;
}

interface SortDropdownProps {
  sortBy: string;
  setSortBy: (value: string) => void;
  sortOptions: SortOption[];
  searchHub?: boolean;
}

const SortDropdown = ({ sortBy, setSortBy, sortOptions }: SortDropdownProps) => (
  <select
    aria-label="Sort research results"
    className="h-11 rounded border bg-white px-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    value={sortBy}
    onChange={(event) => setSortBy(event.target.value)}
  >
    {sortOptions.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

export default SortDropdown;
