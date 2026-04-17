import { describe, expect, it } from 'vitest';

import {
  createInitialDepartmentInputState,
  departmentInputReducer,
  DepartmentInputAction,
} from '../departmentInputReducer';

describe('departmentInputReducer', () => {
  it('initial state is closed with empty search and -1 focus', () => {
    const state = createInitialDepartmentInputState();
    expect(state.isDeptDropdownOpen).toBe(false);
    expect(state.deptSearchTerm).toBe('');
    expect(state.focusedDeptIndex).toBe(-1);
  });

  it('OPEN_DROPDOWN opens, clears search, and resets focus index', () => {
    const state = createInitialDepartmentInputState({
      deptSearchTerm: 'stale',
      focusedDeptIndex: 3,
    });
    const next = departmentInputReducer(state, { type: 'OPEN_DROPDOWN' });
    expect(next.isDeptDropdownOpen).toBe(true);
    expect(next.deptSearchTerm).toBe('');
    expect(next.focusedDeptIndex).toBe(-1);
  });

  it('CLOSE_DROPDOWN closes, clears search, and resets focus index atomically', () => {
    const state = createInitialDepartmentInputState({
      isDeptDropdownOpen: true,
      deptSearchTerm: 'bio',
      focusedDeptIndex: 2,
    });
    const next = departmentInputReducer(state, { type: 'CLOSE_DROPDOWN' });
    expect(next.isDeptDropdownOpen).toBe(false);
    expect(next.deptSearchTerm).toBe('');
    expect(next.focusedDeptIndex).toBe(-1);
  });

  it('SET_SEARCH updates search and resets focus index', () => {
    const state = createInitialDepartmentInputState({
      isDeptDropdownOpen: true,
      focusedDeptIndex: 5,
    });
    const next = departmentInputReducer(state, { type: 'SET_SEARCH', payload: 'chem' });
    expect(next.deptSearchTerm).toBe('chem');
    expect(next.focusedDeptIndex).toBe(-1);
    expect(next.isDeptDropdownOpen).toBe(true);
  });

  it('SET_FOCUSED_INDEX supports a numeric value', () => {
    const state = createInitialDepartmentInputState();
    const next = departmentInputReducer(state, { type: 'SET_FOCUSED_INDEX', payload: 4 });
    expect(next.focusedDeptIndex).toBe(4);
  });

  it('SET_FOCUSED_INDEX supports a functional updater', () => {
    const state = createInitialDepartmentInputState({ focusedDeptIndex: 2 });
    const next = departmentInputReducer(state, {
      type: 'SET_FOCUSED_INDEX',
      payload: (prev) => prev + 1,
    });
    expect(next.focusedDeptIndex).toBe(3);
  });

  it('SELECT_DEPT closes the dropdown atomically', () => {
    const state = createInitialDepartmentInputState({
      isDeptDropdownOpen: true,
      deptSearchTerm: 'bio',
      focusedDeptIndex: 1,
    });
    const next = departmentInputReducer(state, { type: 'SELECT_DEPT' });
    expect(next.isDeptDropdownOpen).toBe(false);
    expect(next.deptSearchTerm).toBe('');
    expect(next.focusedDeptIndex).toBe(-1);
  });

  it('does not mutate previous state', () => {
    const state = createInitialDepartmentInputState({
      isDeptDropdownOpen: true,
      deptSearchTerm: 'abc',
      focusedDeptIndex: 2,
    });
    const snapshot = JSON.stringify(state);
    departmentInputReducer(state, { type: 'OPEN_DROPDOWN' });
    departmentInputReducer(state, { type: 'CLOSE_DROPDOWN' });
    departmentInputReducer(state, { type: 'SET_SEARCH', payload: 'x' });
    departmentInputReducer(state, { type: 'SET_FOCUSED_INDEX', payload: (prev) => prev + 1 });
    departmentInputReducer(state, { type: 'SELECT_DEPT' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('unknown action returns the same state reference', () => {
    const state = createInitialDepartmentInputState();
    const next = departmentInputReducer(state, {
      type: 'NOT_A_REAL_ACTION',
    } as unknown as DepartmentInputAction);
    expect(next).toBe(state);
  });
});
