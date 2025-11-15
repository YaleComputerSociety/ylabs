import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchHub from '../SearchHub.refactored';
import SearchContext, { SearchContextType } from '../../../contexts/SearchContext';

// Mock SweetAlert
vi.mock('sweetalert', () => ({
  default: vi.fn(() => Promise.resolve(true)),
}));

describe('SearchHub', () => {
  const mockSetQuery = vi.fn();
  const mockAddDepartment = vi.fn();
  const mockRemoveDepartment = vi.fn();
  const mockClearDepartments = vi.fn();
  const mockSetSort = vi.fn();
  const mockToggleSortDirection = vi.fn();
  const mockNextPage = vi.fn();
  const mockResetSearch = vi.fn();
  const mockDispatch = vi.fn();

  const defaultContextValue: SearchContextType = {
    state: {
      query: '',
      selectedDepartments: [],
      sortBy: 'default',
      sortOrder: 1,
      page: 1,
      pageSize: 20,
      searchExhausted: false,
      listings: [],
      isLoading: false,
    },
    dispatch: mockDispatch,
    setQuery: mockSetQuery,
    addDepartment: mockAddDepartment,
    removeDepartment: mockRemoveDepartment,
    clearDepartments: mockClearDepartments,
    setSort: mockSetSort,
    toggleSortDirection: mockToggleSortDirection,
    nextPage: mockNextPage,
    resetSearch: mockResetSearch,
  };

  const defaultProps = {
    allDepartments: ['Computer Science', 'Biology', 'Mathematics', 'Physics'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithContext = (contextValue: Partial<SearchContextType> = {}) => {
    const mergedContext = {
      ...defaultContextValue,
      ...contextValue,
      state: {
        ...defaultContextValue.state,
        ...(contextValue.state || {}),
      },
    };

    return render(
      <SearchContext.Provider value={mergedContext}>
        <SearchHub {...defaultProps} />
      </SearchContext.Provider>
    );
  };

  describe('Search Input', () => {
    test('renders search input with placeholder', () => {
      renderWithContext();
      expect(screen.getByPlaceholderText('Start your search...')).toBeInTheDocument();
    });

    test('displays current query from context', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          query: 'machine learning',
        },
      });

      const searchInput = screen.getByPlaceholderText(
        'Start your search...'
      ) as HTMLInputElement;
      expect(searchInput.value).toBe('machine learning');
    });

    test('calls setQuery when input changes', () => {
      renderWithContext();

      const searchInput = screen.getByPlaceholderText('Start your search...');
      fireEvent.change(searchInput, { target: { value: 'deep learning' } });

      expect(mockSetQuery).toHaveBeenCalledWith('deep learning');
    });

    test('blurs input on Enter key', () => {
      renderWithContext();

      const searchInput = screen.getByPlaceholderText('Start your search...');
      searchInput.focus();
      expect(searchInput).toHaveFocus();

      fireEvent.keyDown(searchInput, { key: 'Enter' });

      expect(searchInput).not.toHaveFocus();
    });

    test('blurs input on Escape key', () => {
      renderWithContext();

      const searchInput = screen.getByPlaceholderText('Start your search...');
      searchInput.focus();

      fireEvent.keyDown(searchInput, { key: 'Escape' });

      expect(searchInput).not.toHaveFocus();
    });
  });

  describe('Department Dropdown', () => {
    test('renders department filter button', () => {
      renderWithContext();
      expect(screen.getByText('Filter by department')).toBeInTheDocument();
    });

    test('opens dropdown when button is clicked', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search departments...')).toBeInTheDocument();
      });
    });

    test('displays all departments in dropdown', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      await waitFor(() => {
        expect(screen.getByText('Computer Science')).toBeInTheDocument();
        expect(screen.getByText('Biology')).toBeInTheDocument();
        expect(screen.getByText('Mathematics')).toBeInTheDocument();
        expect(screen.getByText('Physics')).toBeInTheDocument();
      });
    });

    test('filters departments based on search input', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const departmentSearchInput = await screen.findByPlaceholderText(
        'Search departments...'
      );
      fireEvent.change(departmentSearchInput, { target: { value: 'comp' } });

      await waitFor(() => {
        expect(screen.getByText('Computer Science')).toBeInTheDocument();
        expect(screen.queryByText('Biology')).not.toBeInTheDocument();
      });
    });

    test('calls addDepartment when department is clicked', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const csOption = await screen.findByText('Computer Science');
      fireEvent.click(csOption);

      expect(mockAddDepartment).toHaveBeenCalledWith('Computer Science');
    });

    test('excludes already selected departments from dropdown', async () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science'],
        },
      });

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      await waitFor(() => {
        // Computer Science should not be in dropdown
        const items = screen.queryAllByText('Computer Science');
        // It should only appear in the filter badges, not in dropdown
        const dropdownItems = items.filter((item) =>
          item.closest('ul')
        );
        expect(dropdownItems.length).toBe(0);
      });
    });

    test('closes dropdown on Escape key', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const departmentSearchInput = await screen.findByPlaceholderText(
        'Search departments...'
      );

      fireEvent.keyDown(departmentSearchInput, { key: 'Escape' });

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('Search departments...')
        ).not.toBeInTheDocument();
      });
    });

    test('keyboard navigation with ArrowDown', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const departmentSearchInput = await screen.findByPlaceholderText(
        'Search departments...'
      );

      fireEvent.keyDown(departmentSearchInput, { key: 'ArrowDown' });

      // First item should be focused (have bg-blue-100 class)
      const firstItem = screen.getByText('Computer Science').closest('li');
      expect(firstItem).toHaveClass('bg-blue-100');
    });

    test('selects focused department on Enter key', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const departmentSearchInput = await screen.findByPlaceholderText(
        'Search departments...'
      );

      // Focus first item
      fireEvent.keyDown(departmentSearchInput, { key: 'ArrowDown' });
      // Select it
      fireEvent.keyDown(departmentSearchInput, { key: 'Enter' });

      expect(mockAddDepartment).toHaveBeenCalledWith('Computer Science');
    });
  });

  describe('Selected Department Filters', () => {
    test('displays selected departments as badges', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science', 'Biology'],
        },
      });

      expect(screen.getByText('Filters:')).toBeInTheDocument();
      expect(screen.getByText('Computer Science')).toBeInTheDocument();
      expect(screen.getByText('Biology')).toBeInTheDocument();
    });

    test('does not display filter section when no departments selected', () => {
      renderWithContext();

      expect(screen.queryByText('Filters:')).not.toBeInTheDocument();
    });

    test('calls removeDepartment when X button is clicked', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science'],
        },
      });

      const removeButton = screen.getByRole('button', { name: '×' });
      fireEvent.click(removeButton);

      expect(mockRemoveDepartment).toHaveBeenCalledWith('Computer Science');
    });

    test('displays "Remove All" button when 2+ departments selected', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science', 'Biology'],
        },
      });

      expect(screen.getByText('Remove All')).toBeInTheDocument();
    });

    test('does not display "Remove All" button when < 2 departments', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science'],
        },
      });

      expect(screen.queryByText('Remove All')).not.toBeInTheDocument();
    });

    test('calls clearDepartments when "Remove All" is clicked', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          selectedDepartments: ['Computer Science', 'Biology', 'Physics'],
        },
      });

      const removeAllButton = screen.getByText('Remove All');
      fireEvent.click(removeAllButton);

      expect(mockClearDepartments).toHaveBeenCalled();
    });
  });

  describe('Sort Controls', () => {
    test('displays sort dropdown', () => {
      renderWithContext();

      expect(screen.getByDisplayValue('Sort by: Best Match')).toBeInTheDocument();
    });

    test('does not display sort direction toggle when sortBy is default', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          sortBy: 'default',
        },
      });

      const sortToggle = screen.queryByLabelText(/Sort ascending|Sort descending/);
      expect(sortToggle).not.toBeInTheDocument();
    });

    test('displays sort direction toggle when sortBy is not default', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          sortBy: 'updatedAt',
        },
      });

      const sortToggle = screen.getByLabelText(/Sort ascending/);
      expect(sortToggle).toBeInTheDocument();
    });

    test('calls toggleSortDirection when toggle button is clicked', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          sortBy: 'updatedAt',
        },
      });

      const sortToggle = screen.getByLabelText(/Sort ascending/);
      fireEvent.click(sortToggle);

      expect(mockToggleSortDirection).toHaveBeenCalled();
    });

    test('displays correct icon rotation for ascending sort', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          sortBy: 'updatedAt',
          sortOrder: 1,
        },
      });

      const sortToggle = screen.getByLabelText('Sort ascending');
      const svg = sortToggle.querySelector('svg');

      expect(svg).toHaveClass('rotate-0');
    });

    test('displays correct icon rotation for descending sort', () => {
      renderWithContext({
        state: {
          ...defaultContextValue.state,
          sortBy: 'updatedAt',
          sortOrder: -1,
        },
      });

      const sortToggle = screen.getByLabelText('Sort descending');
      const svg = sortToggle.querySelector('svg');

      expect(svg).toHaveClass('rotate-180');
    });
  });

  describe('Integration Tests', () => {
    test('selecting department clears department search input', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      const departmentSearchInput = await screen.findByPlaceholderText(
        'Search departments...'
      );
      fireEvent.change(departmentSearchInput, { target: { value: 'comp' } });

      const csOption = screen.getByText('Computer Science');
      fireEvent.click(csOption);

      // Department search should be cleared
      await waitFor(() => {
        const input = screen.queryByPlaceholderText('Search departments...');
        if (input) {
          expect((input as HTMLInputElement).value).toBe('');
        }
      });
    });

    test('closes dropdown when clicking outside', async () => {
      renderWithContext();

      const dropdownButton = screen.getByText('Filter by department');
      fireEvent.click(dropdownButton);

      await screen.findByPlaceholderText('Search departments...');

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('Search departments...')
        ).not.toBeInTheDocument();
      });
    });
  });
});
