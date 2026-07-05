import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ResearchAreaInput from '../ResearchAreaInput';

vi.mock('../../../../../hooks/useConfig', () => ({
  useConfig: () => ({
    researchAreas: [],
    researchFields: [
      { name: 'Engineering', colorKey: 'blue' },
      { name: 'Life Sciences', colorKey: 'green' },
    ],
    getColorForResearchArea: () => ({
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-100',
    }),
    refreshConfig: vi.fn(),
    isLoading: false,
  }),
}));

describe('ResearchAreaInput field selector dialog accessibility', () => {
  it('moves focus into the dialog, traps Tab, and restores focus on close', async () => {
    const user = userEvent.setup();
    render(
      <ResearchAreaInput
        researchAreas={[]}
        onAddResearchArea={vi.fn()}
        onRemoveResearchArea={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/research areas/i);

    await user.type(input, 'Quantum');
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: /add new research area/i });
    const firstField = screen.getByRole('button', { name: /engineering/i });
    const lastField = screen.getByRole('button', { name: /cancel/i });

    expect(firstField).toHaveFocus();

    dialog.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(lastField).toHaveFocus();

    await user.tab();
    expect(firstField).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(input).toHaveFocus();
  });
});
