import { describe, test, expect } from 'vitest';
import { searchReducer, initialSearchState } from '../searchReducer';
import { SearchState, SearchAction } from '../../contexts/SearchContext';

describe('searchReducer', () => {
  describe('SET_QUERY', () => {
    test('updates query and resets page to 1', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 3,
        query: 'old query',
      };

      const action: SearchAction = {
        type: 'SET_QUERY',
        payload: 'machine learning',
      };

      const newState = searchReducer(state, action);

      expect(newState.query).toBe('machine learning');
      expect(newState.page).toBe(1);
    });
  });

  describe('ADD_DEPARTMENT', () => {
    test('adds department to selectedDepartments', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science'],
      };

      const action: SearchAction = {
        type: 'ADD_DEPARTMENT',
        payload: 'Biology',
      };

      const newState = searchReducer(state, action);

      expect(newState.selectedDepartments).toEqual(['Computer Science', 'Biology']);
      expect(newState.page).toBe(1);
    });

    test('prevents adding duplicate departments', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science'],
      };

      const action: SearchAction = {
        type: 'ADD_DEPARTMENT',
        payload: 'Computer Science',
      };

      const newState = searchReducer(state, action);

      expect(newState.selectedDepartments).toEqual(['Computer Science']);
      expect(newState).toBe(state); // Should return same reference
    });

    test('resets page to 1 when adding department', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 5,
      };

      const action: SearchAction = {
        type: 'ADD_DEPARTMENT',
        payload: 'Mathematics',
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(1);
    });
  });

  describe('REMOVE_DEPARTMENT', () => {
    test('removes department from selectedDepartments', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science', 'Biology', 'Mathematics'],
      };

      const action: SearchAction = {
        type: 'REMOVE_DEPARTMENT',
        payload: 'Biology',
      };

      const newState = searchReducer(state, action);

      expect(newState.selectedDepartments).toEqual(['Computer Science', 'Mathematics']);
      expect(newState.page).toBe(1);
    });

    test('does nothing if department not in list', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science'],
      };

      const action: SearchAction = {
        type: 'REMOVE_DEPARTMENT',
        payload: 'Physics',
      };

      const newState = searchReducer(state, action);

      expect(newState.selectedDepartments).toEqual(['Computer Science']);
    });
  });

  describe('CLEAR_DEPARTMENTS', () => {
    test('removes all departments', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science', 'Biology', 'Mathematics'],
        page: 3,
      };

      const action: SearchAction = {
        type: 'CLEAR_DEPARTMENTS',
      };

      const newState = searchReducer(state, action);

      expect(newState.selectedDepartments).toEqual([]);
      expect(newState.page).toBe(1);
    });
  });

  describe('SET_SORT', () => {
    test('updates sortBy and sortOrder', () => {
      const state: SearchState = {
        ...initialSearchState,
        sortBy: 'default',
        sortOrder: 1,
      };

      const action: SearchAction = {
        type: 'SET_SORT',
        payload: { sortBy: 'updatedAt', sortOrder: -1 },
      };

      const newState = searchReducer(state, action);

      expect(newState.sortBy).toBe('updatedAt');
      expect(newState.sortOrder).toBe(-1);
      expect(newState.page).toBe(1);
    });

    test('resets page to 1 when sort changes', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 7,
      };

      const action: SearchAction = {
        type: 'SET_SORT',
        payload: { sortBy: 'title', sortOrder: 1 },
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(1);
    });
  });

  describe('TOGGLE_SORT_DIRECTION', () => {
    test('toggles sortOrder from 1 to -1', () => {
      const state: SearchState = {
        ...initialSearchState,
        sortOrder: 1,
      };

      const action: SearchAction = {
        type: 'TOGGLE_SORT_DIRECTION',
      };

      const newState = searchReducer(state, action);

      expect(newState.sortOrder).toBe(-1);
    });

    test('toggles sortOrder from -1 to 1', () => {
      const state: SearchState = {
        ...initialSearchState,
        sortOrder: -1,
      };

      const action: SearchAction = {
        type: 'TOGGLE_SORT_DIRECTION',
      };

      const newState = searchReducer(state, action);

      expect(newState.sortOrder).toBe(1);
    });

    test('resets page to 1 when toggling sort direction', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 4,
      };

      const action: SearchAction = {
        type: 'TOGGLE_SORT_DIRECTION',
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(1);
    });
  });

  describe('SET_PAGE', () => {
    test('sets page to specific value', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 1,
      };

      const action: SearchAction = {
        type: 'SET_PAGE',
        payload: 5,
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(5);
    });
  });

  describe('INCREMENT_PAGE', () => {
    test('increments page by 1', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 3,
      };

      const action: SearchAction = {
        type: 'INCREMENT_PAGE',
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(4);
    });
  });

  describe('RESET_PAGE', () => {
    test('resets page to 1', () => {
      const state: SearchState = {
        ...initialSearchState,
        page: 10,
      };

      const action: SearchAction = {
        type: 'RESET_PAGE',
      };

      const newState = searchReducer(state, action);

      expect(newState.page).toBe(1);
    });
  });

  describe('SET_LISTINGS', () => {
    test('replaces listings array', () => {
      const mockListings = [
        { id: '1', title: 'Listing 1' },
        { id: '2', title: 'Listing 2' },
      ] as any;

      const state: SearchState = {
        ...initialSearchState,
        listings: [{ id: 'old', title: 'Old' }] as any,
        pageSize: 20,
      };

      const action: SearchAction = {
        type: 'SET_LISTINGS',
        payload: mockListings,
      };

      const newState = searchReducer(state, action);

      expect(newState.listings).toEqual(mockListings);
      expect(newState.listings).not.toBe(state.listings);
    });

    test('sets searchExhausted to true when results < pageSize', () => {
      const mockListings = [{ id: '1', title: 'Listing 1' }] as any;

      const state: SearchState = {
        ...initialSearchState,
        pageSize: 20,
      };

      const action: SearchAction = {
        type: 'SET_LISTINGS',
        payload: mockListings,
      };

      const newState = searchReducer(state, action);

      expect(newState.searchExhausted).toBe(true);
    });

    test('sets searchExhausted to false when results === pageSize', () => {
      const mockListings = Array(20)
        .fill(null)
        .map((_, i) => ({ id: String(i), title: `Listing ${i}` })) as any;

      const state: SearchState = {
        ...initialSearchState,
        pageSize: 20,
      };

      const action: SearchAction = {
        type: 'SET_LISTINGS',
        payload: mockListings,
      };

      const newState = searchReducer(state, action);

      expect(newState.searchExhausted).toBe(false);
    });
  });

  describe('APPEND_LISTINGS', () => {
    test('appends listings to existing array', () => {
      const existingListings = [{ id: '1', title: 'Existing' }] as any;
      const newListings = [{ id: '2', title: 'New' }] as any;

      const state: SearchState = {
        ...initialSearchState,
        listings: existingListings,
        pageSize: 20,
      };

      const action: SearchAction = {
        type: 'APPEND_LISTINGS',
        payload: newListings,
      };

      const newState = searchReducer(state, action);

      expect(newState.listings).toEqual([...existingListings, ...newListings]);
    });

    test('sets searchExhausted based on new listings length', () => {
      const state: SearchState = {
        ...initialSearchState,
        listings: [],
        pageSize: 20,
      };

      const action: SearchAction = {
        type: 'APPEND_LISTINGS',
        payload: Array(5).fill({ id: '1', title: 'Test' }) as any,
      };

      const newState = searchReducer(state, action);

      expect(newState.searchExhausted).toBe(true);
    });
  });

  describe('SET_SEARCH_EXHAUSTED', () => {
    test('sets searchExhausted to true', () => {
      const state: SearchState = {
        ...initialSearchState,
        searchExhausted: false,
      };

      const action: SearchAction = {
        type: 'SET_SEARCH_EXHAUSTED',
        payload: true,
      };

      const newState = searchReducer(state, action);

      expect(newState.searchExhausted).toBe(true);
    });

    test('sets searchExhausted to false', () => {
      const state: SearchState = {
        ...initialSearchState,
        searchExhausted: true,
      };

      const action: SearchAction = {
        type: 'SET_SEARCH_EXHAUSTED',
        payload: false,
      };

      const newState = searchReducer(state, action);

      expect(newState.searchExhausted).toBe(false);
    });
  });

  describe('SET_LOADING', () => {
    test('sets isLoading to true', () => {
      const state: SearchState = {
        ...initialSearchState,
        isLoading: false,
      };

      const action: SearchAction = {
        type: 'SET_LOADING',
        payload: true,
      };

      const newState = searchReducer(state, action);

      expect(newState.isLoading).toBe(true);
    });

    test('sets isLoading to false', () => {
      const state: SearchState = {
        ...initialSearchState,
        isLoading: true,
      };

      const action: SearchAction = {
        type: 'SET_LOADING',
        payload: false,
      };

      const newState = searchReducer(state, action);

      expect(newState.isLoading).toBe(false);
    });
  });

  describe('RESET_SEARCH', () => {
    test('resets all state to initial values', () => {
      const state: SearchState = {
        query: 'test query',
        selectedDepartments: ['Computer Science', 'Biology'],
        sortBy: 'updatedAt',
        sortOrder: -1,
        page: 5,
        pageSize: 20,
        searchExhausted: true,
        listings: [{ id: '1', title: 'Test' }] as any,
        isLoading: true,
      };

      const action: SearchAction = {
        type: 'RESET_SEARCH',
      };

      const newState = searchReducer(state, action);

      expect(newState).toEqual(initialSearchState);
    });
  });

  describe('Edge Cases', () => {
    test('returns same state for unknown action type', () => {
      const state: SearchState = {
        ...initialSearchState,
        query: 'test',
      };

      const action = {
        type: 'UNKNOWN_ACTION',
      } as any;

      const newState = searchReducer(state, action);

      expect(newState).toBe(state);
    });

    test('immutability - does not mutate original state', () => {
      const state: SearchState = {
        ...initialSearchState,
        selectedDepartments: ['Computer Science'],
      };

      const originalDepartments = state.selectedDepartments;

      const action: SearchAction = {
        type: 'ADD_DEPARTMENT',
        payload: 'Biology',
      };

      searchReducer(state, action);

      expect(state.selectedDepartments).toBe(originalDepartments);
      expect(state.selectedDepartments).toEqual(['Computer Science']);
    });
  });
});
