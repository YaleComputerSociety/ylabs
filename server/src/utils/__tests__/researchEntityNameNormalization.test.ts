import { describe, expect, it } from 'vitest';

import {
  hasTrailingResearchHomeDescription,
  normalizeResearchEntityNameDashes,
  stripTrailingResearchHomeDescription,
} from '../researchEntityNameNormalization';

describe('normalizeResearchEntityNameDashes', () => {
  it('converts an em-dash faculty-research suffix to a plain hyphen (#519)', () => {
    expect(normalizeResearchEntityNameDashes('Jane Doe — Research')).toBe('Jane Doe - Research');
  });

  it('converts en dashes inside descriptive names', () => {
    expect(
      normalizeResearchEntityNameDashes(
        'FRESH Collaborative – Family-centered Research in Equity, Safety and Healing',
      ),
    ).toBe('FRESH Collaborative - Family-centered Research in Equity, Safety and Healing');
  });

  it('leaves plain-hyphen and dash-free names untouched', () => {
    expect(normalizeResearchEntityNameDashes('Jordan Example - Research')).toBe(
      'Jordan Example - Research',
    );
    expect(normalizeResearchEntityNameDashes('Example Lab')).toBe('Example Lab');
  });

  it('collapses doubled spaces left by dash removal but preserves single spacing', () => {
    expect(normalizeResearchEntityNameDashes('Example  —  Research')).toBe('Example - Research');
  });
});

describe('stripTrailingResearchHomeDescription', () => {
  it('strips a description sentence glued onto a lab name (#797)', () => {
    expect(
      stripTrailingResearchHomeDescription(
        'Example Lab We study how immune cells and metabolic networks restore tissue health.',
      ),
    ).toBe('Example Lab');
  });

  it('strips description prose from center, institute, and program names', () => {
    expect(
      stripTrailingResearchHomeDescription(
        'Example Center The center focuses on the intersection of energy and economics.',
      ),
    ).toBe('Example Center');
    expect(
      stripTrailingResearchHomeDescription(
        'Example Institute Our research investigates population dynamics.',
      ),
    ).toBe('Example Institute');
    expect(
      stripTrailingResearchHomeDescription(
        'Example Program This program develops open teaching resources.',
      ),
    ).toBe('Example Program');
  });

  it('leaves clean research-home names untouched', () => {
    expect(stripTrailingResearchHomeDescription('Example Lab')).toBe('Example Lab');
    expect(stripTrailingResearchHomeDescription('Jordan Example - Research')).toBe(
      'Jordan Example - Research',
    );
    expect(stripTrailingResearchHomeDescription('Institute for the Study of Global Affairs')).toBe(
      'Institute for the Study of Global Affairs',
    );
  });

  it('returns non-string input unchanged', () => {
    expect(stripTrailingResearchHomeDescription(undefined as unknown as string)).toBe(undefined);
  });
});

describe('hasTrailingResearchHomeDescription', () => {
  it('detects run-on descriptions across head-noun categories', () => {
    expect(
      hasTrailingResearchHomeDescription('Fineberg Lab The Fineberg Lab investigates'),
    ).toBe(true);
    expect(hasTrailingResearchHomeDescription('Laboratory We study X')).toBe(true);
    expect(hasTrailingResearchHomeDescription('Consortium We advance Y')).toBe(true);
    expect(hasTrailingResearchHomeDescription('Program The program supports Z')).toBe(true);
  });

  it('returns false for clean names and non-string input', () => {
    expect(hasTrailingResearchHomeDescription('Fineberg Lab')).toBe(false);
    expect(hasTrailingResearchHomeDescription('Yale Cancer Center')).toBe(false);
    expect(hasTrailingResearchHomeDescription(undefined as unknown as string)).toBe(false);
  });
});
