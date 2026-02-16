/**
 * Provider component managing fellowship search state and API calls.
 */
import { FC, useState, useEffect, useCallback, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import axios from "../utils/axios";
import swal from "sweetalert";

import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import { Fellowship, FellowshipFilterOptions } from "../types/types";
import { createFellowship } from "../utils/createFellowship";

interface FellowshipSearchContextProviderProps {
  children: ReactNode;
}

const FellowshipSearchContextProvider: FC<FellowshipSearchContextProviderProps> = ({ children }) => {
  const pageSize = 500;
  const sortableKeys = ['default', 'createdAt', 'deadline', 'title'];

  const location = useLocation();
  const isActive = location.pathname === '/fellowships';

  const [queryString, setQueryString] = useState<string>('');

  const [selectedYearOfStudy, setSelectedYearOfStudy] = useState<string[]>([]);
  const [selectedTermOfAward, setSelectedTermOfAward] = useState<string[]>([]);
  const [selectedPurpose, setSelectedPurpose] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedCitizenship, setSelectedCitizenship] = useState<string[]>([]);

  const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
  const [sortOrder, setSortOrder] = useState<number>(-1);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [fellowships, setFellowships] = useState<Fellowship[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchExhausted, setSearchExhausted] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);

  const [page, setPage] = useState<number>(1);

  const [filterOptions, setFilterOptions] = useState<FellowshipFilterOptions>({
    yearOfStudy: [],
    termOfAward: [],
    purpose: [],
    globalRegions: [],
    citizenshipStatus: [],
  });

  const [quickFilter, setQuickFilter] = useState<'open' | 'closingSoon' | 'recent' | null>(null);

  const [filterBarHeight, setFilterBarHeight] = useState<number>(0);

  const [queryStringLoaded, setQueryStringLoaded] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [initialSearchDone, setInitialSearchDone] = useState(false);
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);

  const onToggleSortDirection = useCallback(() => {
    const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
    setSortOrder(newDirection === 'asc' ? 1 : -1);
  }, [sortDirection]);

  useEffect(() => {
    if (!isActive) {
      setInitialSearchDone(false);
      setFilterOptionsLoaded(false);
      setQueryStringLoaded(false);
      setFiltersLoaded(false);
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    axios
      .get('/fellowships/filters')
      .then((response) => {
        setFilterOptions({
          yearOfStudy: response.data.yearOfStudy || [],
          termOfAward: response.data.termOfAward || [],
          purpose: response.data.purpose || [],
          globalRegions: response.data.globalRegions || [],
          citizenshipStatus: response.data.citizenshipStatus || [],
        });
        setFilterOptionsLoaded(true);
      })
      .catch((error) => {
        console.error('Error loading fellowship filter options:', error);
        setFilterOptionsLoaded(true);
      });
  }, [isActive]);

  const handleSearch = useCallback((searchPage: number) => {
    const formattedQuery = queryString.trim();

    let url = `/fellowships/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

    if (sortBy !== 'default') {
      url += `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    }

    if (selectedYearOfStudy.length > 0) {
      url += `&yearOfStudy=${encodeURIComponent(selectedYearOfStudy.join(','))}`;
    }
    if (selectedTermOfAward.length > 0) {
      url += `&termOfAward=${encodeURIComponent(selectedTermOfAward.join(','))}`;
    }
    if (selectedPurpose.length > 0) {
      url += `&purpose=${encodeURIComponent(selectedPurpose.join(','))}`;
    }
    if (selectedRegions.length > 0) {
      url += `&globalRegions=${encodeURIComponent(selectedRegions.join(','))}`;
    }
    if (selectedCitizenship.length > 0) {
      url += `&citizenshipStatus=${encodeURIComponent(selectedCitizenship.join(','))}`;
    }

    setIsLoading(true);

    axios
      .get(url)
      .then((response) => {
        const responseFellowships: Fellowship[] = response.data.results.map(
          (elem: any) => createFellowship(elem)
        );

        if (searchPage === 1) {
          setFellowships(responseFellowships);
        } else {
          setFellowships((oldFellowships) => [...oldFellowships, ...responseFellowships]);
        }
        setTotal(response.data.total || responseFellowships.length);
        setSearchExhausted(responseFellowships.length < pageSize);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Error loading fellowships:', error);
        swal({
          text: 'Unable to load fellowships. Please try again later.',
          icon: 'warning',
        });
        setIsLoading(false);
      });
  }, [queryString, selectedYearOfStudy, selectedTermOfAward, selectedPurpose, selectedRegions, selectedCitizenship, sortBy, sortOrder, pageSize]);

  const refreshFellowships = useCallback(() => {
    setPage(1);
    handleSearch(1);
  }, [handleSearch]);

  useEffect(() => {
    if (!isActive) return;
    if (filterOptionsLoaded && !initialSearchDone) {
      setPage(1);
      handleSearch(1);
      setInitialSearchDone(true);
    }
  }, [filterOptionsLoaded, initialSearchDone, handleSearch, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!filterOptionsLoaded) return;

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
  }, [queryString, filterOptionsLoaded, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!filterOptionsLoaded) return;

    if (filtersLoaded) {
      setPage(1);
      handleSearch(1);
    }
    setFiltersLoaded(true);
  }, [selectedYearOfStudy, selectedTermOfAward, selectedPurpose, selectedRegions, selectedCitizenship, sortBy, sortOrder, filterOptionsLoaded, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (page > 1 && filterOptionsLoaded) {
      handleSearch(page);
    }
  }, [page, filterOptionsLoaded, isActive]);

  return (
    <FellowshipSearchContext.Provider
      value={{
        queryString,
        setQueryString,
        selectedYearOfStudy,
        setSelectedYearOfStudy,
        selectedTermOfAward,
        setSelectedTermOfAward,
        selectedPurpose,
        setSelectedPurpose,
        selectedRegions,
        setSelectedRegions,
        selectedCitizenship,
        setSelectedCitizenship,
        sortBy,
        setSortBy,
        sortOrder,
        setSortOrder,
        sortDirection,
        onToggleSortDirection,
        fellowships,
        isLoading,
        searchExhausted,
        page,
        setPage,
        pageSize,
        total,
        filterOptions,
        sortableKeys,
        refreshFellowships,
        quickFilter,
        setQuickFilter,
        filterBarHeight,
        setFilterBarHeight,
      }}
    >
      {children}
    </FellowshipSearchContext.Provider>
  );
};

export default FellowshipSearchContextProvider;
