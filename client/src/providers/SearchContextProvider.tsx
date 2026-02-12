import { FC, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import axios from "../utils/axios";
import swal from "sweetalert";

import SearchContext, { FilterMode } from "../contexts/SearchContext";
import { Listing } from "../types/types";
import { createListing } from "../utils/apiCleaner";
import { useConfig } from "../hooks/useConfig";

interface SearchContextProviderProps {
  children: ReactNode;
}

const SearchContextProvider: FC<SearchContextProviderProps> = ({ children }) => {
  const pageSize = 20;
  const sortableKeys = ['default', 'createdAt', 'ownerLastName', 'ownerFirstName', 'title'];

  // Get config data from ConfigContext
  const {
    departments,
    departmentCategories,
    researchAreas,
    isLoaded: configLoaded
  } = useConfig();

  // Derive lists from config data
  const allDepartments = useMemo(() =>
    departments.map(d => d.displayName).sort((a, b) => a.localeCompare(b)),
    [departments]
  );

  const allResearchAreas = useMemo(() =>
    [...departmentCategories].sort((a, b) => a.localeCompare(b)),
    [departmentCategories]
  );

  const allListingResearchAreas = useMemo(() =>
    researchAreas.map(area => area.name).sort((a, b) => a.localeCompare(b)),
    [researchAreas]
  );

  // Query state
  const [queryString, setQueryString] = useState<string>('');

  // Department filter state
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  // Research area filter state (Academic Disciplines)
  const [selectedResearchAreas, setSelectedResearchAreas] = useState<string[]>([]);

  // Listing research area filter state (specific tags like "Machine Learning", etc.)
  const [selectedListingResearchAreas, setSelectedListingResearchAreas] = useState<string[]>([]);

  // Per-filter combination modes (intersection = AND, union = OR)
  // Default to 'union' (OR) which is the most common expectation
  const [departmentsFilterMode, setDepartmentsFilterMode] = useState<FilterMode>('union');
  const [researchAreasFilterMode, setResearchAreasFilterMode] = useState<FilterMode>('union');
  const [listingResearchAreasFilterMode, setListingResearchAreasFilterMode] = useState<FilterMode>('union');

  // Sort state
  const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Results
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchExhausted, setSearchExhausted] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Pagination
  const [page, setPage] = useState<number>(1);

  // Filter bar height for dynamic layout
  const [filterBarHeight, setFilterBarHeight] = useState<number>(0);

  // Quick filter state (client-side filters like "Open Only", "Recently Added")
  const [quickFilter, setQuickFilter] = useState<string | null>(null);

  // Track if initial load happened
  const [queryStringLoaded, setQueryStringLoaded] = useState(false);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [initialSearchDone, setInitialSearchDone] = useState(false);

  const onToggleSortDirection = useCallback(() => {
    const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
    setSortOrder(newDirection === 'asc' ? 1 : -1);
  }, [sortDirection]);

  const handleSearch = useCallback((searchPage: number) => {
    const formattedQuery = queryString.trim();

    // Build URL with base params
    let url = `/listings/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

    // Add sort params if not default
    if (sortBy !== 'default') {
      url += `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    }

    // Send departments directly (not merged with disciplines)
    if (selectedDepartments.length > 0) {
      url += `&departments=${encodeURIComponent(selectedDepartments.join('||'))}`;
    }

    // Send academic disciplines separately (backend will resolve to departments)
    if (selectedResearchAreas.length > 0) {
      url += `&academicDisciplines=${encodeURIComponent(selectedResearchAreas.join('||'))}`;
    }

    // Add research areas filter (specific tags like "Machine Learning", etc.)
    if (selectedListingResearchAreas.length > 0) {
      url += `&researchAreas=${encodeURIComponent(selectedListingResearchAreas.join(','))}`;
    }

    // Add per-filter modes (intersection = AND, union = OR)
    url += `&departmentsMode=${departmentsFilterMode}`;
    url += `&academicDisciplinesMode=${researchAreasFilterMode}`;
    url += `&researchAreasMode=${listingResearchAreasFilterMode}`;

    setIsLoading(true);

    axios
      .get(url)
      .then((response) => {
        const responseListings: Listing[] = response.data.results.map(function (
          elem: any
        ) {
          return createListing(elem);
        });

        if (searchPage === 1) {
          setListings(responseListings);
        } else {
          setListings((oldListings) => [...oldListings, ...responseListings]);
        }
        if (response.data.totalCount !== undefined) {
          setTotalCount(response.data.totalCount);
        }
        setSearchExhausted(responseListings.length < pageSize);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Error loading listings:', error);
        swal({
          text: 'Unable to load listings. Please try again later.',
          icon: 'warning',
        });
        setIsLoading(false);
      });
  }, [queryString, selectedDepartments, selectedResearchAreas, selectedListingResearchAreas, departmentsFilterMode, researchAreasFilterMode, listingResearchAreasFilterMode, sortBy, sortOrder, pageSize]);

  // Refresh listings - can be called to force a fresh fetch
  const refreshListings = useCallback(() => {
    setPage(1);
    handleSearch(1);
  }, [handleSearch]);

  // Initial search when config is loaded
  useEffect(() => {
    if (configLoaded && !initialSearchDone) {
      setPage(1);
      handleSearch(1);
      setInitialSearchDone(true);
    }
  }, [configLoaded, initialSearchDone, handleSearch]);

  // Debounced search on query string change
  useEffect(() => {
    if (!configLoaded) return;

    const debounceTimeout = setTimeout(() => {
      if (queryStringLoaded) {
        setPage(1);
        handleSearch(1);
      }
      setQueryStringLoaded(true);
    }, 500);

    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [queryString, configLoaded]);

  // Immediate search on filter/sort change
  useEffect(() => {
    if (!configLoaded) return;

    if (departmentsLoaded) {
      setPage(1);
      handleSearch(1);
    }
    setDepartmentsLoaded(true);
  }, [selectedDepartments, selectedResearchAreas, selectedListingResearchAreas, departmentsFilterMode, researchAreasFilterMode, listingResearchAreasFilterMode, sortBy, sortOrder, configLoaded]);

  // Pagination - load more
  useEffect(() => {
    if (page > 1 && configLoaded) {
      handleSearch(page);
    }
  }, [page, configLoaded]);

  return (
    <SearchContext.Provider
      value={{
        queryString,
        setQueryString,
        selectedDepartments,
        setSelectedDepartments,
        selectedResearchAreas,
        setSelectedResearchAreas,
        selectedListingResearchAreas,
        setSelectedListingResearchAreas,
        allListingResearchAreas,
        departmentsFilterMode,
        setDepartmentsFilterMode,
        researchAreasFilterMode,
        setResearchAreasFilterMode,
        listingResearchAreasFilterMode,
        setListingResearchAreasFilterMode,
        sortBy,
        setSortBy,
        sortOrder,
        setSortOrder,
        sortDirection,
        onToggleSortDirection,
        listings,
        isLoading,
        searchExhausted,
        totalCount,
        page,
        setPage,
        pageSize,
        allDepartments,
        allResearchAreas,
        sortableKeys,
        refreshListings,
        filterBarHeight,
        setFilterBarHeight,
        quickFilter,
        setQuickFilter,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export default SearchContextProvider;
