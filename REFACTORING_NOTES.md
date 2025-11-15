# SearchHub Refactoring Notes

## 🎯 What Changed

### BEFORE (Original SearchHub.tsx):
```typescript
interface SearchHubProps {
    allDepartments: string[];
    resetListings: (listings: Listing[]) => void;
    addListings: (listings: Listing[]) => void;
    setIsLoading: React.Dispatch<React.SetStateAction<Boolean>>;
    sortBy: string;
    sortOrder: number;
    setSortBy: (sortBy: string) => void;
    setSortOrder: (sortOrder: number) => void;
    sortableKeys: string[];
    page: number;
    setPage: React.Dispatch<React.SetStateAction<number>>;
    pageSize: number;
    sortDirection: 'asc' | 'desc';
    onToggleSortDirection: () => void;
}

// 11 state variables managed locally
const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
const [isDropdownOpen, setIsDropdownOpen] = useState(false);
const [searchTerm, setSearchTerm] = useState('');
const [queryString, setQueryString] = useState('');
// ... etc

// Complex API call logic inside component
const handleSearch = (page: Number) => {
  // 45 lines of URL building and API calling
};
```

### AFTER (Refactored SearchHub):
```typescript
interface SearchHubProps {
    allDepartments: string[]; // Only needs department list!
}

// Uses SearchContext for state
const {
  state,
  setQuery,
  addDepartment,
  removeDepartment,
  clearDepartments,
  setSort,
  toggleSortDirection,
} = useContext(SearchContext);

// Only 3 LOCAL UI state variables (dropdown state)
const [isDropdownOpen, setIsDropdownOpen] = useState(false);
const [searchTerm, setSearchTerm] = useState('');
const [focusedDepartmentIndex, setFocusedDepartmentIndex] = useState(-1);

// No API call logic - handled by SearchContextProvider!
```

---

## ✅ Benefits

### 1. **Props Eliminated** (14 → 1)
- ❌ Removed: `resetListings`, `addListings`, `setIsLoading`, `sortBy`, `sortOrder`, `setSortBy`, `setSortOrder`, `sortableKeys`, `page`, `setPage`, `pageSize`, `sortDirection`, `onToggleSortDirection`
- ✅ Kept: `allDepartments` (static data)

### 2. **State Moved to Context** (8 → 3 local)
**Moved to Context:**
- `query` (formerly `queryString`)
- `selectedDepartments`
- `sortBy`, `sortOrder`
- `page`, `pageSize`
- `listings`, `isLoading`, `searchExhausted`

**Kept Local (UI-only state):**
- `isDropdownOpen`
- `searchTerm` (department filter input)
- `focusedDepartmentIndex` (keyboard navigation)

### 3. **API Logic Centralized**
- All search API calls moved to `SearchContextProvider`
- Automatic debouncing (500ms) handled in provider
- Automatic page reset when filters change
- Component is now purely presentational

### 4. **Testability Improved**
- Can test SearchHub by mocking `useContext(SearchContext)`
- Can test search logic independently in `searchReducer.test.ts`
- Can test API calls in `SearchContextProvider.test.tsx`
- No need to mock axios in SearchHub tests

### 5. **Code Reduced**
- **Original:** ~430 lines
- **Refactored:** ~310 lines (-28%)
- **SearchContextProvider:** ~140 lines (shared logic)
- **Net reduction:** ~120 lines when accounting for shared provider

---

## 🔄 Migration Steps

### Step 1: Wrap App with SearchContextProvider

In `client/src/App.tsx` or `client/src/index.tsx`:

```typescript
import SearchContextProvider from './providers/SearchContextProvider';
import UserContextProvider from './providers/UserContextProvider';

// Wrap your app:
<UserContextProvider>
  <SearchContextProvider>
    <App />
  </SearchContextProvider>
</UserContextProvider>
```

### Step 2: Update home.tsx

**BEFORE:**
```typescript
const [listings, setListings] = useState<Listing[]>([]);
const [isLoading, setIsLoading] = useState<Boolean>(false);
const [searchExhausted, setSearchExhausted] = useState<Boolean>(false);
const [page, setPage] = useState<number>(1);
const [sortBy, setSortBy] = useState<string>('default');
// ... etc

<SearchHub
  allDepartments={departmentKeys}
  resetListings={resetListings}
  addListings={addListings}
  setIsLoading={setIsLoading}
  sortBy={sortBy}
  // ... 13 more props!
/>
```

**AFTER:**
```typescript
import { useContext } from 'react';
import SearchContext from '../contexts/SearchContext';

const { state, nextPage } = useContext(SearchContext);
const { listings, isLoading, searchExhausted } = state;

<SearchHub allDepartments={departmentKeys} />
<ListingsCardList
  loading={isLoading}
  searchExhausted={searchExhausted}
  setPage={nextPage}  // Just pass nextPage callback
  listings={listings}
  // ... other props
/>
```

### Step 3: Update ListingsCardList

**BEFORE:**
```typescript
setPage(prevPage => prevPage + 1); // Directly modifies parent state
```

**AFTER:**
```typescript
const { nextPage } = useContext(SearchContext);
nextPage(); // Dispatches INCREMENT_PAGE action
```

---

## 🧪 Testing Strategy

### Test 1: searchReducer.test.ts (Pure function - easiest!)
```typescript
describe('searchReducer', () => {
  test('SET_QUERY updates query and resets page to 1')
  test('ADD_DEPARTMENT adds department and resets page')
  test('REMOVE_DEPARTMENT removes department')
  test('TOGGLE_SORT_DIRECTION toggles between 1 and -1')
  test('SET_LISTINGS replaces listings')
  test('APPEND_LISTINGS adds to existing listings')
})
```

### Test 2: SearchContextProvider.test.tsx (Integration)
```typescript
describe('SearchContextProvider', () => {
  test('executes search on mount')
  test('debounces query changes for 500ms')
  test('executes search immediately on department change')
  test('increments page and appends listings')
  test('handles API errors gracefully')
})
```

### Test 3: SearchHub.test.tsx (Component)
```typescript
describe('SearchHub', () => {
  test('displays current query from context')
  test('calls setQuery when input changes')
  test('opens department dropdown on click')
  test('calls addDepartment when department selected')
  test('calls removeDepartment when X clicked')
  test('calls toggleSortDirection on sort toggle')
})
```

---

## 🚨 Potential Issues & Solutions

### Issue 1: Multiple useEffect triggers
**Problem:** Provider has 3 useEffect hooks that call `executeSearch()`
**Solution:** Add proper dependency arrays and debouncing

### Issue 2: Infinite loops
**Problem:** `executeSearch` depends on `state`, which changes when listings update
**Solution:** ✅ Already fixed - `executeSearch` only depends on search parameters, not results

### Issue 3: Initial mount double-fetch
**Problem:** useEffect runs on mount for query, departments, and sort
**Solution:** Add initialization flag:
```typescript
const [initialized, setInitialized] = useState(false);

useEffect(() => {
  if (!initialized) {
    setInitialized(true);
    executeSearch();
  }
}, []);
```

---

## 📝 Next Steps

1. ✅ Create test files for reducer and provider
2. ✅ Backup original SearchHub.tsx
3. ✅ Replace with refactored version
4. ✅ Update home.tsx to use SearchContext
5. ✅ Update ListingsCardList if needed
6. ✅ Run tests and fix any issues
7. ✅ Test in browser thoroughly
8. ✅ Remove old unused props from interfaces
