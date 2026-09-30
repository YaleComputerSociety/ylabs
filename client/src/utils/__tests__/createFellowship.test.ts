import { describe, expect, it } from 'vitest';

import { getItemCardSummary } from '../../types/browsable';
import { createFellowship } from '../createFellowship';

const cardLineFor = (row: Record<string, unknown>) =>
  getItemCardSummary({ type: 'fellowship', data: createFellowship(row) });

describe('createFellowship card line', () => {
  it('shows the served card line instead of a deadline-only stored summary', () => {
    expect(
      cardLineFor({
        _id: 'p-1',
        summary: 'Synthetic Program deadline: March 1.',
        cardSummary: 'Funds a summer of full-time laboratory research.',
      }),
    ).toBe('Funds a summer of full-time laboratory research.');
  });

  it('shows the served card line when the stored summary is empty', () => {
    expect(
      cardLineFor({
        _id: 'p-2',
        summary: '',
        cardSummary: 'Pairs students with a faculty mentor for a term.',
      }),
    ).toBe('Pairs students with a faculty mentor for a term.');
  });

  it('keeps an empty served card line so the card fails closed', () => {
    expect(
      cardLineFor({ _id: 'p-3', summary: 'Synthetic Program deadline: March 1.', cardSummary: '' }),
    ).toBe('');
  });

  it('falls back to the stored summary when no card line is served', () => {
    expect(cardLineFor({ _id: 'p-4', summary: 'A descriptive stored summary.' })).toBe(
      'A descriptive stored summary.',
    );
  });
});
