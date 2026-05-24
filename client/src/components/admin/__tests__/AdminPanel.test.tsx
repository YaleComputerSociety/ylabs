import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminPanel from '../AdminPanel';

vi.mock('../AdminListingsTable', () => ({
  default: () => <div data-testid="legacy-listings-table" />,
}));

vi.mock('../AdminFellowshipsTable', () => ({
  default: () => <div data-testid="fellowships-table" />,
}));

vi.mock('../AdminResearchAreas', () => ({
  default: () => <div data-testid="research-areas" />,
}));

vi.mock('../AdminDepartments', () => ({
  default: () => <div data-testid="departments" />,
}));

vi.mock('../AdminFacultyProfilesTable', () => ({
  default: () => <div data-testid="faculty-profiles" />,
}));

vi.mock('../AdminAccessReview', () => ({
  default: () => <div data-testid="access-review" />,
}));

afterEach(() => {
  cleanup();
});

describe('AdminPanel', () => {
  it('opens on access review instead of the retired legacy listings endpoint', () => {
    render(<AdminPanel />);

    expect(screen.getByTestId('access-review')).toBeTruthy();
    expect(screen.queryByTestId('legacy-listings-table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Legacy Listing Evidence' })).toBeNull();
  });

  it('keeps admin tab controls large enough for touch input', () => {
    render(<AdminPanel />);

    for (const tab of [
      'Access Review',
      'Fellowships',
      'Research Areas',
      'Departments',
      'Faculty Profiles',
    ]) {
      expect(screen.getByRole('button', { name: tab }).className).toContain('min-h-[44px]');
    }
  });
});
