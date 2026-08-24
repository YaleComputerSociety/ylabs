import { describe, expect, it } from 'vitest';

import {
  collapseDuplicateResearchHomeSuffix,
  hasDuplicateResearchHomeSuffix,
  hasResearchHomeNamePersonCredentials,
  hasTrailingResearchHomeDescription,
  normalizeResearchEntityNameDashes,
  stripResearchHomeNamePersonCredentials,
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
    expect(hasTrailingResearchHomeDescription('Fineberg Lab The Fineberg Lab investigates')).toBe(
      true,
    );
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

describe('collapseDuplicateResearchHomeSuffix', () => {
  it('collapses a doubled trailing head-noun suffix (#1081)', () => {
    expect(collapseDuplicateResearchHomeSuffix('Jane Taylor Lab Lab')).toBe('Jane Taylor Lab');
  });

  it('collapses doubled suffixes across head-noun categories and casing', () => {
    expect(collapseDuplicateResearchHomeSuffix('Example Laboratory Laboratory')).toBe(
      'Example Laboratory',
    );
    expect(collapseDuplicateResearchHomeSuffix('Yale Cancer Center Center')).toBe(
      'Yale Cancer Center',
    );
    expect(collapseDuplicateResearchHomeSuffix('Doe Faculty Research Research')).toBe(
      'Doe Faculty Research',
    );
    expect(collapseDuplicateResearchHomeSuffix('Example Lab lab')).toBe('Example Lab');
    expect(collapseDuplicateResearchHomeSuffix('Example Lab Lab Lab')).toBe('Example Lab');
  });

  it('preserves legitimate repeated personal-name tokens', () => {
    expect(collapseDuplicateResearchHomeSuffix('Lu Lu Lab')).toBe('Lu Lu Lab');
    expect(collapseDuplicateResearchHomeSuffix('Yang Yang Research')).toBe('Yang Yang Research');
    expect(collapseDuplicateResearchHomeSuffix('Liang Liang Research')).toBe('Liang Liang Research');
  });

  it('leaves clean names and non-string input untouched', () => {
    expect(collapseDuplicateResearchHomeSuffix('Example Lab')).toBe('Example Lab');
    expect(collapseDuplicateResearchHomeSuffix('Institute for the Study of Global Affairs')).toBe(
      'Institute for the Study of Global Affairs',
    );
    expect(collapseDuplicateResearchHomeSuffix(undefined as unknown as string)).toBe(undefined);
  });
});

describe('hasDuplicateResearchHomeSuffix', () => {
  it('detects doubled suffixes and ignores clean or repeated-name inputs', () => {
    expect(hasDuplicateResearchHomeSuffix('Jane Taylor Lab Lab')).toBe(true);
    expect(hasDuplicateResearchHomeSuffix('Lu Lu Lab')).toBe(false);
    expect(hasDuplicateResearchHomeSuffix('Example Lab')).toBe(false);
    expect(hasDuplicateResearchHomeSuffix(undefined as unknown as string)).toBe(false);
  });
});

describe('stripResearchHomeNamePersonCredentials', () => {
  it('strips a trailing single degree credential minted as a research-home name (#1858)', () => {
    expect(stripResearchHomeNamePersonCredentials('Jason L. Schwartz, Ph.D.')).toBe(
      'Jason L. Schwartz',
    );
  });

  it('strips a comma-separated credential run appearing before a head-noun suffix (#1858)', () => {
    expect(stripResearchHomeNamePersonCredentials('Mark A Lemmon, PhD, FRS Lab')).toBe(
      'Mark A Lemmon Lab',
    );
    expect(stripResearchHomeNamePersonCredentials('Mark A Lemmon, PhD, FRS Faculty Research')).toBe(
      'Mark A Lemmon Faculty Research',
    );
  });

  it('handles the common medical and doctoral post-nominals', () => {
    expect(stripResearchHomeNamePersonCredentials('Alex Rivera, M.D.')).toBe('Alex Rivera');
    expect(stripResearchHomeNamePersonCredentials('Sam Okafor, M.D., M.P.H. Lab')).toBe(
      'Sam Okafor Lab',
    );
    expect(stripResearchHomeNamePersonCredentials('Robin Chen, Sc.D.')).toBe('Robin Chen');
  });

  it('leaves branded names, person-name lists, and unrelated tokens untouched', () => {
    expect(stripResearchHomeNamePersonCredentials('Regan Lab')).toBe('Regan Lab');
    expect(stripResearchHomeNamePersonCredentials('MD Anderson Cancer Center')).toBe(
      'MD Anderson Cancer Center',
    );
    expect(stripResearchHomeNamePersonCredentials('Warren Research Website')).toBe(
      'Warren Research Website',
    );
    expect(stripResearchHomeNamePersonCredentials('Smith, Jones, and Lee Lab')).toBe(
      'Smith, Jones, and Lee Lab',
    );
  });

  it('does not strip credentials followed by further descriptive prose', () => {
    expect(stripResearchHomeNamePersonCredentials('Dana Lee, M.D., Director of Foo')).toBe(
      'Dana Lee, M.D., Director of Foo',
    );
  });

  it('returns non-string input unchanged', () => {
    expect(stripResearchHomeNamePersonCredentials(undefined as unknown as string)).toBe(undefined);
  });
});

describe('hasResearchHomeNamePersonCredentials', () => {
  it('detects credential-laden names and ignores clean or non-string inputs', () => {
    expect(hasResearchHomeNamePersonCredentials('Jason L. Schwartz, Ph.D.')).toBe(true);
    expect(hasResearchHomeNamePersonCredentials('Mark A Lemmon, PhD, FRS Lab')).toBe(true);
    expect(hasResearchHomeNamePersonCredentials('Regan Lab')).toBe(false);
    expect(hasResearchHomeNamePersonCredentials(undefined as unknown as string)).toBe(false);
  });
});
