import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import {
  createInitialFellowshipSearchState,
  fellowshipSearchReducer,
} from '../../reducers/fellowshipSearchReducer';
import { useProgramSearchUrlSync } from '../useProgramSearchUrlSync';

const ProgramsSurface = () => {
  useProgramSearchUrlSync();
  return null;
};

const Harness = () => {
  const [state, dispatch] = useReducer(fellowshipSearchReducer, undefined, () =>
    createInitialFellowshipSearchState(),
  );
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <FellowshipSearchContext.Provider
      value={{
        ...defaultFellowshipSearchContext,
        ...state,
        sortableKeys: ['default', 'deadline', 'title'],
        setQueryString: (value) => dispatch({ type: 'SET_QUERY_STRING', payload: value }),
        setQuickFilter: (value) => dispatch({ type: 'SET_QUICK_FILTER', payload: value }),
        setSelectedYearOfStudy: (value) =>
          dispatch({ type: 'SET_SELECTED_YEAR_OF_STUDY', payload: value }),
        applyUrlState: (value) => dispatch({ type: 'APPLY_URL_STATE', payload: value }),
      }}
    >
      <label>
        Search
        <input
          value={state.queryString}
          onChange={(event) => dispatch({ type: 'SET_QUERY_STRING', payload: event.target.value })}
        />
      </label>
      <button
        type="button"
        onClick={() => dispatch({ type: 'SET_QUICK_FILTER', payload: 'firstYear' })}
      >
        First-years
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'SET_SELECTED_YEAR_OF_STUDY', payload: ['Junior'] })}
      >
        Juniors
      </button>
      <button type="button" onClick={() => void navigate('/research')}>
        Leave
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        Back
      </button>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <span data-testid="quick">{state.quickFilter ?? 'none'}</span>
      <span data-testid="years">{state.selectedYearOfStudy.join(',')}</span>
      <Routes>
        <Route path="/programs" element={<ProgramsSurface />} />
        <Route path="/research" element={<p>Research page</p>} />
      </Routes>
    </FellowshipSearchContext.Provider>
  );
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness />
    </MemoryRouter>,
  );

describe('useProgramSearchUrlSync', () => {
  it('writes the search and filters to the URL and restores them after Back', async () => {
    renderAt('/programs');

    await userEvent.type(screen.getByLabelText('Search'), 'economics summer');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/programs?q=economics+summer'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'First-years' }));
    await userEvent.click(screen.getByRole('button', { name: 'Juniors' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/programs?q=economics+summer&quick=firstYear&year=Junior',
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/programs?q=economics+summer&quick=firstYear',
      ),
    );
    expect(screen.getByTestId('years')).toHaveTextContent('');
    expect(screen.getByTestId('quick')).toHaveTextContent('firstYear');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByText('Research page');
    await userEvent.clear(screen.getByLabelText('Search'));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.getByLabelText('Search')).toHaveValue('economics summer'));
    expect(screen.getByTestId('quick')).toHaveTextContent('firstYear');
  });

  it('opens a shared link with its search, quick filter, and filters applied', async () => {
    renderAt('/programs?q=blue+center&quick=open&year=Senior&year=Junior&program=abc');

    await waitFor(() => expect(screen.getByLabelText('Search')).toHaveValue('blue center'));
    expect(screen.getByTestId('quick')).toHaveTextContent('open');
    expect(screen.getByTestId('years')).toHaveTextContent('Senior,Junior');
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/programs?q=blue+center&quick=open&year=Senior&year=Junior&program=abc',
    );
  });

  it('ignores an unknown quick filter in the URL', async () => {
    renderAt('/programs?quick=everything');

    await screen.findByTestId('quick');
    expect(screen.getByTestId('quick')).toHaveTextContent('none');
  });
});
