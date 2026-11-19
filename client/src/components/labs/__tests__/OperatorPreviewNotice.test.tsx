import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import OperatorPreviewNotice from '../OperatorPreviewNotice';

describe('OperatorPreviewNotice', () => {
  it('names the tier and every check that withholds the page from students', () => {
    const { container } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'operator_review',
          studentVisibilityBlockingReasons: ['thin_description', 'missing_card_description'],
          studentVisibilitySignalReasons: [],
          withheldBy: ['visibility_tier', 'description_invariant'],
        }}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('students cannot see this page. Tier: Review.');
    expect(text).toContain('Visibility tier is not public');
    expect(text).toContain('Description fails the public description check');
    expect(text).toContain('Held because: thin description, missing card description');
    expect(text).not.toContain('Signals:');
    expect(text).not.toContain('Gate reasons');
    expect(text).not.toContain('Suppression reason');
  });

  it('lists blockers before soft signals and keeps the signals out of the held line', () => {
    const { getByText } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'operator_review',
          studentVisibilityBlockingReasons: ['profile_identity_risk'],
          studentVisibilitySignalReasons: ['source_backed_description', 'missing_facet_signal'],
          withheldBy: ['visibility_tier'],
        }}
      />,
    );

    const held = getByText('Held because:').parentElement;
    const signals = getByText('Signals:').parentElement;
    expect(held?.textContent).toBe('Held because: profile identity risk');
    expect(signals?.textContent).toBe('Signals: source backed description, missing facet signal');
    expect(held?.compareDocumentPosition(signals as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says plainly when only soft signals remain', () => {
    const { container } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'operator_review',
          studentVisibilityBlockingReasons: [],
          studentVisibilitySignalReasons: ['source_backed_description'],
          withheldBy: ['description_invariant'],
        }}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Held because: no blocking reason is recorded, only the signals below.');
    expect(text).toContain('Signals: source backed description');
  });

  it('shows the suppression reason when one is recorded', () => {
    const { container } = render(
      <OperatorPreviewNotice
        preview={{
          studentVisibilityTier: 'suppressed',
          studentVisibilityBlockingReasons: [],
          studentVisibilitySignalReasons: [],
          studentVisibilitySuppressionReason: 'not a research group',
          withheldBy: ['visibility_tier'],
        }}
      />,
    );

    expect(container.textContent).toContain('Tier: Suppressed.');
    expect(container.textContent).toContain('Suppression reason: not a research group');
    expect(container.textContent).not.toContain('Held because');
  });
});
