import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardMetric } from '../analyticsPresentation';

const definition = 'Distinct students who opened a synthetic source detail.';

describe('DashboardMetric', () => {
  it('shows the metric definition as visible text instead of a hover-only title', () => {
    render(<DashboardMetric title="Source reviewers" value={3} context="In range." definition={definition} />);

    const definitionText = screen.getByText(definition);
    expect(definitionText.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('exposes the definition as the accessible description of the metric card', () => {
    render(<DashboardMetric title="Source reviewers" value={3} context="In range." definition={definition} />);

    expect(screen.getByRole('group', { name: 'Source reviewers' })).toHaveAccessibleDescription(definition);
  });

  it('leaves a metric without a definition undescribed', () => {
    render(<DashboardMetric title="Items to review" value={0} context="Nothing flagged." />);

    expect(screen.getByRole('group', { name: 'Items to review' })).not.toHaveAttribute('aria-describedby');
  });
});
