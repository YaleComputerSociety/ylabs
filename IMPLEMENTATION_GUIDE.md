# 🚀 SearchHub Refactoring Implementation Guide

## 📁 Files Created

```
✅ client/src/contexts/SearchContext.ts
✅ client/src/reducers/searchReducer.ts
✅ client/src/providers/SearchContextProvider.tsx
✅ client/src/components/home/SearchHub.refactored.tsx
✅ client/src/reducers/__tests__/searchReducer.test.ts
✅ client/src/components/home/__tests__/SearchHub.test.tsx
```

---

## 🔧 Step-by-Step Implementation

### STEP 1: Add SearchContextProvider to App

**File: `client/src/index.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import UserContextProvider from './providers/UserContextProvider';
import SearchContextProvider from './providers/SearchContextProvider'; // ✅ ADD THIS
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <UserContextProvider>
      <SearchContextProvider> {/* ✅ ADD THIS */}
        <App />
      </SearchContextProvider> {/* ✅ ADD THIS */}
    </UserContextProvider>
  </React.StrictMode>
);
```

---

### STEP 2: Replace SearchHub.tsx

**Option A: Rename and replace**
```bash
cd client/src/components/home
mv SearchHub.tsx SearchHub.old.tsx
mv SearchHub.refactored.tsx SearchHub.tsx
```

**Option B: Manually update SearchHub.tsx**
- Copy contents from `SearchHub.refactored.tsx`
- Paste into `SearchHub.tsx`

---

### STEP 3: Update home.tsx

**File: `client/src/pages/home.tsx`**

**BEFORE:**
```typescript
import {useState, useEffect} from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchHub from "../components/home/SearchHub";
import { departmentCategories } from "../utils/departmentNames";
import axios from "../utils/axios";
import styled from "styled-components";
import {Listing} from '../types/types';
import swal from "sweetalert";

const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);
    const [searchExhausted, setSearchExhausted] = useState<Boolean>(false);
    const [page, setPage] = useState<number>(1);
    const pageSize = 20;

    const sortableKeys = ['default', 'updatedAt', 'ownerLastName', 'ownerFirstName', 'title']

    const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
    const [sortOrder, setSortOrder] = useState<number>(1);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    const handleToggleSortDirection = () => {
        const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        setSortDirection(newDirection);
        setSortOrder(newDirection === 'asc' ? 1 : -1);
    };

    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);

    const departmentKeys = Object.keys(departmentCategories).sort((a, b) => a.localeCompare(b));

    const reloadFavorites = async () => {
        axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
        }).catch((error => {
            console.error("Error fetching user's favorite listings:", error);
            setFavListingsIds([]);
            swal({
                text: "Could not load your favorite listings",
                icon: "warning",
            })
        }));
    }

    useEffect(() => {
        reloadFavorites();
    }, []);

    const addListings = (listings: Listing[]) => {
        setListings((oldListings) => [...oldListings, ...listings]);
        setSearchExhausted(listings.length < pageSize);
    };

    const resetListings = (listings: Listing[]) => {
        setListings(listings);
        setSearchExhausted(listings.length < pageSize);
    };

    const updateFavorite = (listingId: string, favorite: boolean) => {
        const prevFavListingsIds = favListingsIds;

        if(favorite) {
            setFavListingsIds([listingId, ...prevFavListingsIds]);

            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({
                    text: "Unable to favorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        } else {
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));

            axios.delete('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({
                    text: "Unable to unfavorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        }
    };

    return (
        <div className="mx-auto max-w-[1300px] px-6 mt-24 w-full">
            <div className='mt-12'>
                <SearchHub
                    allDepartments={departmentKeys}
                    resetListings={resetListings}
                    addListings={addListings}
                    setIsLoading={setIsLoading}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    setSortBy={setSortBy}
                    setSortOrder={setSortOrder}
                    sortDirection={sortDirection}
                    onToggleSortDirection={handleToggleSortDirection}
                    sortableKeys={sortableKeys}
                    page={page}
                    setPage={setPage}
                    pageSize={pageSize}
                />
            </div>
            <div className='mt-4 md:mt-10'></div>
            {listings.length > 0 ? (
                <ListingsCardList
                    loading={isLoading}
                    searchExhausted={searchExhausted}
                    setPage={setPage}
                    listings={listings}
                    sortableKeys={sortableKeys}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    setSortOrder={setSortOrder}
                    sortDirection={sortDirection}
                    onToggleSortDirection={handleToggleSortDirection}
                    favListingsIds={favListingsIds}
                    updateFavorite={updateFavorite}
                />
            ) : (
                <NoResultsText>No results match the search criteria</NoResultsText>
            )}
        </div>
    );
};

export default Home;

const NoResultsText = styled.h4`
  color: #838383;
  text-align: center;
  padding-top: 15%;
`;
```

**AFTER:**
```typescript
import { useContext, useState, useEffect } from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchHub from "../components/home/SearchHub";
import SearchContext from "../contexts/SearchContext"; // ✅ ADD THIS
import { departmentCategories } from "../utils/departmentNames";
import axios from "../utils/axios";
import styled from "styled-components";
import swal from "sweetalert";

const Home = () => {
    // ✅ GET SEARCH STATE FROM CONTEXT
    const { state, nextPage } = useContext(SearchContext);
    const { listings, isLoading, searchExhausted, sortBy, sortOrder } = state;

    const sortDirection = sortOrder === 1 ? 'asc' : 'desc';
    const sortableKeys = ['default', 'updatedAt', 'ownerLastName', 'ownerFirstName', 'title'];

    // ✅ KEEP FAVORITES (will be refactored to FavoritesContext later)
    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);

    const departmentKeys = Object.keys(departmentCategories).sort((a, b) => a.localeCompare(b));

    const reloadFavorites = async () => {
        axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
        }).catch((error => {
            console.error("Error fetching user's favorite listings:", error);
            setFavListingsIds([]);
            swal({
                text: "Could not load your favorite listings",
                icon: "warning",
            })
        }));
    }

    useEffect(() => {
        reloadFavorites();
    }, []);

    const updateFavorite = (listingId: string, favorite: boolean) => {
        const prevFavListingsIds = favListingsIds;

        if(favorite) {
            setFavListingsIds([listingId, ...prevFavListingsIds]);

            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({
                    text: "Unable to favorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        } else {
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));

            axios.delete('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({
                    text: "Unable to unfavorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        }
    };

    return (
        <div className="mx-auto max-w-[1300px] px-6 mt-24 w-full">
            <div className='mt-12'>
                {/* ✅ SIMPLIFIED - ONLY PASS allDepartments */}
                <SearchHub allDepartments={departmentKeys} />
            </div>
            <div className='mt-4 md:mt-10'></div>
            {listings.length > 0 ? (
                <ListingsCardList
                    loading={isLoading}
                    searchExhausted={searchExhausted}
                    setPage={nextPage}  {/* ✅ SIMPLIFIED */}
                    listings={listings}
                    sortableKeys={sortableKeys}
                    sortBy={sortBy}
                    setSortBy={() => {}}  {/* ✅ NO LONGER USED */}
                    setSortOrder={() => {}}  {/* ✅ NO LONGER USED */}
                    sortDirection={sortDirection}
                    onToggleSortDirection={() => {}}  {/* ✅ NO LONGER USED */}
                    favListingsIds={favListingsIds}
                    updateFavorite={updateFavorite}
                />
            ) : (
                <NoResultsText>No results match the search criteria</NoResultsText>
            )}
        </div>
    );
};

export default Home;

const NoResultsText = styled.h4`
  color: #838383;
  text-align: center;
  padding-top: 15%;
`;
```

**Lines removed:** ~50 lines
**State management:** Centralized in SearchContext

---

### STEP 4: Update ListingsCardList (Optional Cleanup)

**File: `client/src/components/home/ListingsCardList.tsx`**

You can optionally refactor this component to use SearchContext directly:

```typescript
import { useContext } from 'react';
import SearchContext from '../../contexts/SearchContext';

export default function ListingsCardList({ favListingsIds, updateFavorite }: ListingsCardListProps) {
  const { state, nextPage } = useContext(SearchContext);
  const { listings, isLoading, searchExhausted, sortBy } = state;

  // ... rest of component uses state from context
}
```

---

## 🧪 Running Tests

### Run All Tests
```bash
cd client
yarn test
```

### Run Specific Test Files
```bash
# Test the reducer (pure function)
yarn test searchReducer.test

# Test SearchHub component
yarn test SearchHub.test
```

### Run Tests with Coverage
```bash
yarn test --coverage
```

---

## ✅ Verification Checklist

### Before Testing:
- [ ] All new files created in correct locations
- [ ] SearchContextProvider added to index.tsx
- [ ] SearchHub.tsx updated with refactored version
- [ ] home.tsx updated to use SearchContext

### Test in Browser:
- [ ] Search bar works (type query, see results)
- [ ] Department filter works (select, remove, "Remove All")
- [ ] Sorting works (change sort, toggle direction)
- [ ] Infinite scroll works (scroll down, more results load)
- [ ] Loading state displays correctly
- [ ] Debouncing works (type fast, only 1 API call after 500ms)
- [ ] No console errors

### Test Automated Tests:
- [ ] `yarn test searchReducer.test` - All 40+ tests pass
- [ ] `yarn test SearchHub.test` - All component tests pass
- [ ] No failing tests

---

## 🐛 Troubleshooting

### Issue: "Cannot find module 'SearchContext'"
**Solution:** Check import path in files:
```typescript
import SearchContext from '../contexts/SearchContext';  // Adjust ../ based on file location
```

### Issue: "useContext is not a function"
**Solution:** Ensure React import includes useContext:
```typescript
import { useContext } from 'react';
```

### Issue: Tests failing with "Cannot read property 'state' of undefined"
**Solution:** Make sure tests wrap component with SearchContext.Provider:
```typescript
<SearchContext.Provider value={mockContextValue}>
  <SearchHub {...props} />
</SearchContext.Provider>
```

### Issue: Infinite loop / Too many re-renders
**Solution:** Check SearchContextProvider useEffect dependencies:
- Query changes → debounced (500ms)
- Department/sort changes → immediate
- Page changes → only when page > 1

### Issue: Multiple API calls on mount
**Solution:** This is expected initially (3 useEffects trigger). To fix:
```typescript
// In SearchContextProvider, add initialization flag
const [initialized, setInitialized] = useState(false);

useEffect(() => {
  if (!initialized) {
    setInitialized(true);
    executeSearch();
  }
}, []);
```

---

## 📈 Performance Improvements

### Before Refactoring:
- ❌ 14 props drilled through components
- ❌ API logic duplicated in component
- ❌ Manual debouncing with flags
- ❌ Manual page reset on filter changes
- ❌ Complex state dependencies

### After Refactoring:
- ✅ 1 prop (allDepartments)
- ✅ Centralized API logic
- ✅ Automatic debouncing in provider
- ✅ Automatic page reset via reducer
- ✅ Predictable state with useReducer

---

## 🎯 Next Steps

After SearchHub is working:

1. **Refactor FavoritesContext** (similar pattern)
   - Create contexts/FavoritesContext.ts
   - Create providers/FavoritesContextProvider.tsx
   - Remove favorites logic from home.tsx and account.tsx

2. **Add More Tests**
   - Test SearchContextProvider (API calls, debouncing)
   - Test ListingsCardList (infinite scroll)
   - Test integration between components

3. **Consider Additional Refactors**
   - ListingCard (extract complex logic)
   - ListingForm (consider React Hook Form)
   - Analytics (split into smaller components)

---

## 📚 Learning Resources

- [React Context API](https://react.dev/learn/passing-data-deeply-with-context)
- [useReducer Hook](https://react.dev/reference/react/useReducer)
- [Vitest Testing](https://vitest.dev/guide/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)

---

**Good luck! 🚀**
