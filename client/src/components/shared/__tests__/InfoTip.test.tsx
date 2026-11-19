import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import InfoTip from '../InfoTip';

describe('InfoTip', () => {
  it('names its button, describes it with the tip, and keeps the tip closed until asked', () => {
    render(<InfoTip label="About Undergrads" text="Shows research matching every ticked option" />);

    const button = screen.getByRole('button', { name: 'About Undergrads' });
    expect(button).toHaveAccessibleDescription('Shows research matching every ticked option');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on keyboard focus and closes on Escape and blur', () => {
    render(<InfoTip label="About Undergrads" text="Shows research matching every ticked option" />);

    const button = screen.getByRole('button', { name: 'About Undergrads' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Shows research matching every ticked option',
    );
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('lets another control name the tip text through a given id while it is closed', () => {
    render(
      <>
        <input type="checkbox" aria-label="Advises undergrad research" aria-describedby="hint-id" />
        <InfoTip
          label="About Advises undergrad research"
          text="e.g. supervised senior theses"
          tipId="hint-id"
        />
      </>,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Advises undergrad research' }),
    ).toHaveAccessibleDescription('e.g. supervised senior theses');
  });
});
