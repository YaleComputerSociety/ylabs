import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('../AdminCorrectionReports', () => ({
  default: () => <div data-testid="correction-reports" />,
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

    for (const tab of ['Operator Board', 'Fellowships', 'Topics', 'Departments']) {
      expect(screen.getByRole('tab', { name: tab }).className).toContain('min-h-[44px]');
    }
  });

  it('exposes the admin controls as a tablist with the open panel selected', () => {
    render(<AdminPanel />);

    expect(screen.getByRole('tablist', { name: 'Admin controls' })).toBeTruthy();
    const selected = screen.getByRole('tab', { name: 'Operator Board', selected: true });
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    const panel = screen.getByRole('tabpanel', { name: 'Operator Board' });
    expect(selected.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.contains(screen.getByTestId('operator-board'))).toBe(true);
  });

  it('moves selection and focus between admin tabs with the arrow, Home, and End keys', () => {
    render(<AdminPanel />);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Operator Board' }), { key: 'ArrowRight' });
    const reports = screen.getByRole('tab', { name: 'Correction Reports', selected: true });
    expect(document.activeElement).toBe(reports);
    expect(screen.getByTestId('correction-reports')).toBeTruthy();
    expect(screen.queryByTestId('operator-board')).toBeNull();

    fireEvent.keyDown(reports, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Departments', selected: true })).toBe(
      document.activeElement,
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Operator Board', selected: true })).toBe(
      document.activeElement,
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Departments', selected: true })).toBeTruthy();
  });

  it('keeps only the selected admin tab in the tab order', () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Topics' }));

    for (const tab of screen.getAllByRole('tab')) {
      const expected = tab.textContent === 'Topics' ? '0' : '-1';
      expect(tab.getAttribute('tabindex')).toBe(expected);
    }
    expect(screen.getByTestId('research-areas')).toBeTruthy();
  });

  it('lets the admin tab strip scroll inside its own region instead of widening the page', () => {
    render(<AdminPanel />);

    expect(screen.getByRole('tablist', { name: 'Admin controls' }).className).toContain(
      'overflow-x-auto',
    );
  });
});
