/**
 * Provider component managing listing search state and API calls.
 */
import { FC, useState, useEffect, useCallback, useMemo, useContext, ReactNode } from "react";
import axios from "../utils/axios";
import swal from "sweetalert";

import SearchContext, { FilterMode } from "../contexts/SearchContext";
import UserContext from "../contexts/UserContext";
import { Listing } from "../types/types";
import { createListing } from "../utils/apiCleaner";
import { useConfig } from "../hooks/useConfig";

interface SearchContextProviderProps {
  children: ReactNode;
}

const SearchContextProvider: FC<SearchContextProviderProps> = ({ children }) => {
  const pageSize = 20;
  const sortableKeys = ['default', 'createdAt', 'ownerLastName', 'ownerFirstName', 'title'];

  const { isAuthenticated, isLoading: authLoading } = useContext(UserContext);

  const {
    departments,
    departmentCategories,
    researchAreas,
    isLoaded: configLoaded
  } = useConfig();

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

  const [queryString, setQueryString] = useState<string>('');

  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  const [selectedResearchAreas, setSelectedResearchAreas] = useState<string[]>([]);

  const [selectedListingResearchAreas, setSelectedListingResearchAreas] = useState<string[]>([]);

  const [departmentsFilterMode, setDepartmentsFilterMode] = useState<FilterMode>('union');
  const [researchAreasFilterMode, setResearchAreasFilterMode] = useState<FilterMode>('union');
  const [listingResearchAreasFilterMode, setListingResearchAreasFilterMode] = useState<FilterMode>('union');

  const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchExhausted, setSearchExhausted] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [page, setPage] = useState<number>(1);

  const [filterBarHeight, setFilterBarHeight] = useState<number>(0);

  const [quickFilter, setQuickFilter] = useState<string | null>(null);

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

    let url = `/listings/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

    if (sortBy !== 'default') {
      url += `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    }

    if (selectedDepartments.length > 0) {
      url += `&departments=${encodeURIComponent(selectedDepartments.join('||'))}`;
    }

    if (selectedResearchAreas.length > 0) {
      url += `&academicDisciplines=${encodeURIComponent(selectedResearchAreas.join('||'))}`;
    }

    if (selectedListingResearchAreas.length > 0) {
      url += `&researchAreas=${encodeURIComponent(selectedListingResearchAreas.join(','))}`;
    }

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
        if (error?.response?.status !== 401) {
          swal({
            text: 'Unable to load listings. Please try again later.',
            icon: 'warning',
          });
        }
        setIsLoading(false);
      });
  }, [queryString, selectedDepartments, selectedResearchAreas, selectedListingResearchAreas, departmentsFilterMode, researchAreasFilterMode, listingResearchAreasFilterMode, sortBy, sortOrder, pageSize]);

  const refreshListings = useCallback(() => {
    setPage(1);
    handleSearch(1);
  }, [handleSearch]);

  useEffect(() => {
    if (configLoaded && !authLoading && isAuthenticated && !initialSearchDone) {
      setPage(1);
      handleSearch(1);
      setInitialSearchDone(true);
    }
  }, [configLoaded, authLoading, isAuthenticated, initialSearchDone, handleSearch]);

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

  useEffect(() => {
    if (!configLoaded) return;

    if (departmentsLoaded) {
      setPage(1);
      handleSearch(1);
    }
    setDepartmentsLoaded(true);
  }, [selectedDepartments, selectedResearchAreas, selectedListingResearchAreas, departmentsFilterMode, researchAreasFilterMode, listingResearchAreasFilterMode, sortBy, sortOrder, configLoaded]);

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
