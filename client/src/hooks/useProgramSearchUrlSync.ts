import { useContext, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';

import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import { FellowshipQuickFilter } from '../reducers/fellowshipSearchReducer';
import {
  ProgramSearchUrlState,
  programSearchUrlStateKey,
  programSearchUrlStatesDifferOnlyInQuery,
  readProgramSearchUrlState,
  writeProgramSearchUrlState,
} from '../utils/programSearchUrlState';

interface ProgramSearchUrlWriteHistoryState {
  programSearchUrlWrite: true;
}

const PROGRAM_SEARCH_URL_WRITE_STATE: ProgramSearchUrlWriteHistoryState = {
  programSearchUrlWrite: true,
};

const isOwnProgramSearchUrlWrite = (historyState: unknown) =>
  (historyState as Partial<ProgramSearchUrlWriteHistoryState> | null)?.programSearchUrlWrite ===
  true;

export const useProgramSearchUrlSync = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const {
    queryString,
    quickFilter,
    selectedYearOfStudy,
    selectedProgramCategory,
    selectedProgramKind,
    selectedEntryMode,
    selectedStudentFacingCategory,
    selectedTermOfAward,
    selectedPurpose,
    selectedSubjects,
    selectedRegions,
    selectedCitizenship,
    sortBy,
    sortDirection,
    sortableKeys,
    applyUrlState,
  } = useContext(FellowshipSearchContext);

  const searchState = useMemo<ProgramSearchUrlState>(
    () => ({
      queryString,
      quickFilter: quickFilter as FellowshipQuickFilter,
      selectedYearOfStudy,
      selectedProgramCategory,
      selectedProgramKind,
      selectedEntryMode,
      selectedStudentFacingCategory,
      selectedTermOfAward,
      selectedPurpose,
      selectedSubjects,
      selectedRegions,
      selectedCitizenship,
      sortBy,
      sortDirection,
    }),
    [
      queryString,
      quickFilter,
      selectedYearOfStudy,
      selectedProgramCategory,
      selectedProgramKind,
      selectedEntryMode,
      selectedStudentFacingCategory,
      selectedTermOfAward,
      selectedPurpose,
      selectedSubjects,
      selectedRegions,
      selectedCitizenship,
      sortBy,
      sortDirection,
    ],
  );
  const searchStateKey = programSearchUrlStateKey(searchState);
  const urlState = useMemo(
    () => readProgramSearchUrlState(searchParams, sortableKeys),
    [searchParams, sortableKeys],
  );
  const urlStateKey = programSearchUrlStateKey(urlState);

  const appliedUrlStateKeyRef = useRef<string | null>(null);
  const pendingHydrationKeyRef = useRef<string | null>(null);
  const writtenSearchStateRef = useRef<ProgramSearchUrlState | null>(null);

  useEffect(() => {
    const firstRun = appliedUrlStateKeyRef.current === null;
    if (appliedUrlStateKeyRef.current === urlStateKey) return;
    appliedUrlStateKeyRef.current = urlStateKey;
    const ownWrite = navigationType !== 'POP' && isOwnProgramSearchUrlWrite(location.state);
    if (!firstRun && ownWrite) return;
    if (urlStateKey === searchStateKey) return;
    pendingHydrationKeyRef.current = urlStateKey;
    applyUrlState(urlState);
  }, [urlStateKey, urlState, searchStateKey, navigationType, location.state, applyUrlState]);

  useEffect(() => {
    const pendingHydrationKey = pendingHydrationKeyRef.current;
    if (pendingHydrationKey !== null) {
      if (searchStateKey !== pendingHydrationKey) return;
      pendingHydrationKeyRef.current = null;
      writtenSearchStateRef.current = searchState;
      return;
    }
    const previous = writtenSearchStateRef.current;
    writtenSearchStateRef.current = searchState;
    if (previous === null || programSearchUrlStateKey(previous) === searchStateKey) return;
    if (searchStateKey === urlStateKey) return;
    setSearchParams((params) => writeProgramSearchUrlState(params, searchState), {
      replace: programSearchUrlStatesDifferOnlyInQuery(previous, searchState),
      state: PROGRAM_SEARCH_URL_WRITE_STATE,
    });
  }, [searchState, searchStateKey, urlStateKey, setSearchParams]);
};
