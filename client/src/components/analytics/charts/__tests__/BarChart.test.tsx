import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import BarChart from '../BarChart';

afterEach(cleanup);

describe('BarChart', () => {
  it('renders each datum once as an accessible labelled group', () => {
    render(
      <BarChart
        ariaLabel="Visitors by type"
        data={[
          { label: 'Undergrads', value: 40 },
          { label: 'Graduates', value: 10, note: '25%' },
        ]}
      />,
    );

    const group = screen.getByRole('group', { name: 'Visitors by type' });
    expect(group).toBeTruthy();
    expect(screen.getAllByText('Undergrads')).toHaveLength(1);
    expect(screen.getAllByText('Graduates')).toHaveLength(1);
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('formats values and applies a proportional width to the largest bar', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Entities by type"
        valueFormatter={(value) => `${value} entities`}
        data={[
          { label: 'Lab', value: 30 },
          { label: 'Center', value: 15 },
        ]}
      />,
    );

    expect(screen.getByText('30 entities')).toBeTruthy();
    const bars = container.querySelectorAll('.yr-chart-bar');
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
  });

  it('normalizes bars to share of total and labels each row with count and percent', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Entities by type"
        showShareOfTotal
        valueFormatter={(value) => `${value}`}
        data={[
          { label: 'Lab', value: 75 },
          { label: 'Center', value: 25 },
        ]}
      />,
    );

    const bars = container.querySelectorAll('.yr-chart-bar');
    expect((bars[0] as HTMLElement).style.width).toBe('75%');
    expect((bars[1] as HTMLElement).style.width).toBe('25%');
    expect(screen.getByText('75.0%')).toBeTruthy();
    expect(screen.getByText('25.0%')).toBeTruthy();
  });

  it('shows an empty message when there is no data', () => {
    render(<BarChart ariaLabel="Empty" data={[]} emptyMessage="Nothing yet." />);
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
  });
});
