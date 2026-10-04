import { describe, expect, it } from 'vitest';

import { cardSummary } from '../cardSummary';

describe('cardSummary', () => {
  it('returns a short description unchanged', () => {
    expect(cardSummary('Studies how cells divide.')).toBe('Studies how cells divide.');
  });

  it('collapses whitespace', () => {
    expect(cardSummary('  Studies   how\ncells divide. ')).toBe('Studies how cells divide.');
  });

  it('ends a long description at the last whole sentence that fits', () => {
    const text =
      'The lab studies how neural circuits in the cerebellum learn precise movements over time. ' +
      'We combine electrophysiology, imaging, and computational models to test circuit theories. ' +
      'Undergraduates join ongoing projects.';
    expect(cardSummary(text, 120)).toBe(
      'The lab studies how neural circuits in the cerebellum learn precise movements over time.',
    );
  });

  it('does not end a sentence at an abbreviation', () => {
    const text =
      'Work with Dr. Example covers models of memory, e.g. replay during sleep and its role in learning new tasks. ' +
      'More text follows here.';
    const summary = cardSummary(text, 120);
    expect(summary).toBe(
      'Work with Dr. Example covers models of memory, e.g. replay during sleep and its role in learning new tasks.',
    );
  });

  it('falls back to a word boundary with an ellipsis when no sentence fits', () => {
    const text =
      'A single very long sentence describing computational approaches to protein folding, molecular dynamics, and the design of enzymes for industrial chemistry';
    const summary = cardSummary(text, 80);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(80);
    expect(summary).not.toMatch(/\s…$/);
    expect(text.startsWith(summary.slice(0, -1))).toBe(true);
  });

  it('returns an empty string for a missing description', () => {
    expect(cardSummary(undefined)).toBe('');
  });
});
