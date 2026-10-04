import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import OperatorPreviewNotice from '../OperatorPreviewNotice';

describe('OperatorPreviewNotice', () => {
  it('names the tier and every check that withholds the page from students', () => {
    const { container } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'operator_review',
          studentVisibilityReasons: ['thin_description', 'missing_card_description'],
          withheldBy: ['visibility_tier', 'description_invariant'],
        }}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('students cannot see this page. Tier: Review.');
    expect(text).toContain('Visibility tier is not public');
    expect(text).toContain('Description fails the public description check');
    expect(text).toContain('Gate reasons: thin description, missing card description');
    expect(text).not.toContain('Suppression reason');
  });

  it('shows the suppression reason when one is recorded', () => {
    const { container } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'suppressed',
          studentVisibilityReasons: [],
          studentVisibilitySuppressionReason: 'not a research group',
          withheldBy: ['visibility_tier'],
        }}
      />,
    );

    expect(container.textContent).toContain('Tier: Suppressed.');
    expect(container.textContent).toContain('Suppression reason: not a research group');
  });
});
