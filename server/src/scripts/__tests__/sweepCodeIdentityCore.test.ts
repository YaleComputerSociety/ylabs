import { describe, expect, it } from 'vitest';
import { planSweepCodeDriftRefusal, sweepCodeIdentityFrom } from '../sweepCodeIdentityCore';

describe('sweepCodeIdentityFrom', () => {
  it('reads a commit a checkout reports', () => {
    expect(sweepCodeIdentityFrom('36474ed54abc')).toEqual({ sha: '36474ed54abc', readable: true });
  });

  it('reports unreadable rather than guessing when the checkout answers with nothing', () => {
    for (const value of ['', '   ', 'fatal: not a git repository', undefined, null, 42]) {
      expect(sweepCodeIdentityFrom(value)).toEqual({ sha: null, readable: false });
    }
  });
});

describe('planSweepCodeDriftRefusal', () => {
  it('proceeds while the checkout has not moved', () => {
    expect(
      planSweepCodeDriftRefusal({
        stage: 'source:nih-reporter',
        startedSha: 'aaa1111',
        currentSha: 'aaa1111',
      }),
    ).toBeNull();
  });

  // The measured shape: 11 stages ran one commit and 13 ran another, and nothing refused.
  it('refuses a stage whose code differs from the stages before it, naming both commits', () => {
    const refusal = planSweepCodeDriftRefusal({
      stage: 'source:nih-reporter',
      startedSha: '83762eee9',
      currentSha: '36474ed54',
    });
    expect(refusal).toMatchObject({
      stage: 'source:nih-reporter',
      startedSha: '83762eee9',
      currentSha: '36474ed54',
    });
    expect(refusal?.message).toContain('83762eee9');
    expect(refusal?.message).toContain('36474ed54');
    expect(refusal?.message).toContain('resume');
  });

  // A checkout with no git metadata cannot say whether the code moved, and a sweep must stay
  // runnable there, so an unreadable commit proceeds rather than refusing.
  it('proceeds when either side is unreadable', () => {
    expect(
      planSweepCodeDriftRefusal({ stage: 's', startedSha: null, currentSha: '36474ed54' }),
    ).toBeNull();
    expect(
      planSweepCodeDriftRefusal({ stage: 's', startedSha: '83762eee9', currentSha: null }),
    ).toBeNull();
  });
});
