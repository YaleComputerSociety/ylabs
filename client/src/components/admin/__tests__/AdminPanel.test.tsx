import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminPanel from '../AdminPanel';

vi.mock('../AdminFellowshipsTable', () => ({
  default: () => <div data-testid="fellowships-table" />,
}));

vi.mock('../AdminResearchAreas', () => ({
  default: () => <div data-testid="research-areas" />,
}));

vi.mock('../AdminDepartments', () => ({
  default: () => <div data-testid="departments" />,
}));

vi.mock('../AdminAccessReview', () => ({
  default: () => <div data-testid="access-review" />,
}));

vi.mock('../AdminOperatorBoard', () => ({
  default: () => <div data-testid="operator-board" />,
}));

afterEach(() => {
  cleanup();
});

describe('AdminPanel', () => {
  it('opens on the operator board instead of the retired legacy listings endpoint', () => {
    render(<AdminPanel />);

    expect(screen.getByTestId('operator-board')).toBeTruthy();
    expect(screen.queryByTestId('legacy-listings-table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Legacy Listing Evidence' })).toBeNull();
  });

  it('keeps admin tab controls large enough for touch input', () => {
    render(<AdminPanel />);

    for (const tab of ['Operator Board', 'Fellowships', 'Research Areas', 'Departments']) {
      expect(screen.getByRole('button', { name: tab }).className).toContain('min-h-[44px]');
    }
  });
});
