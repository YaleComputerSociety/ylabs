import { describe, expect, it } from 'vitest';
import {
  parseCoverageEnvironment,
  summarizeEmailSupportCoverage,
} from '../researcherEmailSupportCoverage';

const marker = (supported: boolean, computedForEmail: string) => ({
  supported,
  sources: supported ? ['fixture-official-profile'] : [],
  computedForEmail,
});

describe('researcher email support coverage (#5627)', () => {
  it('counts a missing or stale marker as unmarked and is fail-closed safe only at zero', () => {
    const coverage = summarizeEmailSupportCoverage([
      {
        identifiers: {
          email: 'avery.synthetic5627@yale.edu',
          emailSupport: marker(true, 'avery.synthetic5627@yale.edu'),
        },
      },
      {
        identifiers: {
          email: 'robin.synthetic5627@yale.edu',
          emailSupport: marker(false, 'robin.synthetic5627@yale.edu'),
        },
      },
      { identifiers: { email: 'casey.synthetic5627@yale.edu' } },
      {
        identifiers: {
          email: 'morgan.synthetic5627@yale.edu',
          emailSupport: marker(true, 'morgan.prior5627@yale.edu'),
        },
      },
    ]);

    expect(coverage).toEqual({
      researchersWithEmail: 4,
      supported: 1,
      unsupported: 1,
      unmarked: 2,
      failClosedSafe: false,
    });
    expect(
      summarizeEmailSupportCoverage([
        {
          identifiers: {
            email: 'avery.synthetic5627@yale.edu',
            emailSupport: marker(false, 'avery.synthetic5627@yale.edu'),
          },
        },
      ]).failClosedSafe,
    ).toBe(true);
  });

  it('reads Development by default and refuses an unknown environment', () => {
    expect(parseCoverageEnvironment([])).toBe('development');
    expect(parseCoverageEnvironment(['--environment=production'])).toBe('production');
    expect(() => parseCoverageEnvironment(['--environment=staging'])).toThrow();
  });
});
