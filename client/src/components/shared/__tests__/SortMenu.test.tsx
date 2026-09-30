import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ResearchSortDropdown, { type ResearchSortField } from '../../research/ResearchSortDropdown';
import FellowshipSortDropdown from '../FellowshipSortDropdown';
import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import { expectNoAxeViolations } from '../../../testUtils/axe';

const ResearchSortHarness = () => {
  const [sortBy, setSortBy] = useState<ResearchSortField>('relevance');
  return (
    <ResearchSortDropdown
      sortBy={sortBy}
      sortOrder="asc"
      onSortByChange={setSortBy}
      onToggleSortDirection={() => {}}
    />
  );
};

const ProgramSortHarness = () => {
  const [sortBy, setSortBy] = useState('default');
  return (
    <FellowshipSearchContext.Provider
      value={{ ...defaultFellowshipSearchContext, sortBy, setSortBy }}
    >
      <FellowshipSortDropdown />
    </FellowshipSearchContext.Provider>
  );
};

const surfaces = [
  { name: 'research', Harness: ResearchSortHarness, subject: 'research', second: 'Name' },
  { name: 'program', Harness: ProgramSortHarness, subject: 'programs', second: 'Deadline' },
] as const;

const sortTrigger = (): HTMLElement => {
  const trigger = screen.getByText('Sort:').closest<HTMLElement>('[tabindex], button');
  if (!trigger) throw new Error('sort trigger not found');
  return trigger;
};

const focusedTrigger = (): HTMLElement => {
  const trigger = sortTrigger();
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  return trigger;
};

describe.each(surfaces)('$name sort menu', ({ Harness, subject, second }) => {
  it('exposes a named combobox that controls a listbox', () => {
    render(<Harness />);

    const trigger = screen.getByRole('combobox', {
      name: `Sort ${subject}, currently Recommended`,
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on Enter and on Space with the current option active', () => {
    render(<Harness />);

    for (const key of ['Enter', ' ']) {
      const trigger = focusedTrigger();
      fireEvent.keyDown(trigger, { key });

      const listbox = screen.getByRole('listbox', { name: `Sort ${subject}` });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', listbox.id);
      const active = document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '');
      expect(active).toHaveAttribute('role', 'option');
      expect(active).toHaveTextContent('Recommended');

      fireEvent.keyDown(trigger, { key: 'Escape' });
    }
  });

  it('names the highlighted option through aria-activedescendant as ArrowDown moves', () => {
    render(<Harness />);
    const trigger = focusedTrigger();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const activeId = trigger.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const active = document.getElementById(activeId ?? '');
    expect(active).toHaveAttribute('role', 'option');
    expect(active).toHaveTextContent(second);
  });

  it('selects the highlighted option on Enter and keeps focus on the trigger', () => {
    render(<Harness />);
    const trigger = focusedTrigger();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(sortTrigger()).toHaveTextContent(second);
    expect(document.activeElement).toBe(sortTrigger());
  });

  it('closes on Escape and returns focus to the trigger rather than the document', () => {
    render(<Harness />);
    const trigger = focusedTrigger();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('selects an option by pointer', () => {
    render(<Harness />);

    fireEvent.click(sortTrigger());
    fireEvent.click(screen.getByRole('option', { name: second }));

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(sortTrigger()).toHaveTextContent(second);
  });

  it('has no blocking accessibility violations while open', async () => {
    const { container } = render(<Harness />);

    fireEvent.keyDown(focusedTrigger(), { key: 'Enter' });

    await expectNoAxeViolations(container);
  });
});
