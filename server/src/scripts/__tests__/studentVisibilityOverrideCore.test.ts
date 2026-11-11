import { describe, expect, it } from 'vitest';
import {
  STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG,
  normalizeOverrideReason,
  parseStudentVisibilityOverrideArgs,
  planStudentVisibilityOverride,
  studentVisibilityOverrideWriteRefusal,
} from '../studentVisibilityOverrideCore';

const REASON = 'umbrella_center_subunits_discoverable: its councils serve under their own names';
const base = ['--slug=center-fixture', `--reason=${REASON}`, '--actor=fixtureop'];

describe('parseStudentVisibilityOverrideArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseStudentVisibilityOverrideArgs([...base, '--tier=suppressed']);
    expect(args).toMatchObject({ apply: false, action: { kind: 'set', tier: 'suppressed' } });
  });

  it('refuses --apply without the confirm flag', () => {
    expect(() =>
      parseStudentVisibilityOverrideArgs([...base, '--tier=suppressed', '--apply']),
    ).toThrow(STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG);
    expect(
      parseStudentVisibilityOverrideArgs([
        ...base,
        '--tier=suppressed',
        '--apply',
        STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG,
      ]).apply,
    ).toBe(true);
  });

  it('takes exactly one row and exactly one action', () => {
    expect(() =>
      parseStudentVisibilityOverrideArgs([...base, '--id=0123456789abcdef01234567', '--clear']),
    ).toThrow('exactly one of --slug or --id');
    expect(() =>
      parseStudentVisibilityOverrideArgs([...base, '--tier=suppressed', '--clear']),
    ).toThrow('exactly one of --tier');
    expect(() => parseStudentVisibilityOverrideArgs(base)).toThrow('exactly one of --tier');
  });

  it('refuses an unknown tier and a missing operator', () => {
    expect(() => parseStudentVisibilityOverrideArgs([...base, '--tier=hidden'])).toThrow('--tier');
    expect(() =>
      parseStudentVisibilityOverrideArgs(['--slug=x', `--reason=${REASON}`, '--tier=suppressed']),
    ).toThrow('--actor');
  });
});

describe('the --actor form', () => {
  it('accepts a netid or an agent identifier and refuses anything else', () => {
    const parse = (actor: string) =>
      parseStudentVisibilityOverrideArgs([
        '--slug=center-fixture',
        `--reason=${REASON}`,
        '--tier=suppressed',
        `--actor=${actor}`,
      ]).actorNetid;
    expect(parse('fixtureop')).toBe('fixtureop');
    expect(parse('agent:sim-people')).toBe('agent:sim-people');
    expect(() => parse('agent:')).toThrow('--actor');
    expect(() => parse('agent:Has Spaces')).toThrow('--actor');
    expect(() => parse('someone@example.edu')).toThrow('--actor');
  });
});

describe('normalizeOverrideReason', () => {
  it('requires a coded, comma-free reason', () => {
    expect(normalizeOverrideReason(`  ${REASON}  `)).toBe(REASON);
    expect(() => normalizeOverrideReason('')).toThrow('--reason is required');
    expect(() => normalizeOverrideReason('no code here')).toThrow('snake_case code');
    expect(() => normalizeOverrideReason('some_code: one, two')).toThrow('comma');
  });

  it('refuses a reason that names a marker other readers match by substring', () => {
    expect(() =>
      normalizeOverrideReason('umbrella_review: not permanently_closed; sub-units served'),
    ).toThrow('permanently_closed');
    expect(() => normalizeOverrideReason('research_infrastructure_only_review: core')).toThrow(
      'research_infrastructure_only',
    );
    expect(() => normalizeOverrideReason('permanently_closed: moved away')).toThrow('reserved');
  });
});

describe('studentVisibilityOverrideWriteRefusal', () => {
  it('lets a dry run through anywhere', () => {
    expect(
      studentVisibilityOverrideWriteRefusal({ apply: false, environment: 'production', env: {} }),
    ).toBeNull();
  });

  it('refuses Beta and Production writes and needs the Development opt-in', () => {
    expect(
      studentVisibilityOverrideWriteRefusal({ apply: true, environment: 'beta', env: {} }),
    ).toContain('promotion');
    expect(
      studentVisibilityOverrideWriteRefusal({ apply: true, environment: 'development', env: {} }),
    ).toContain('ALLOW_NON_PROD_SCRAPER_WRITES');
    expect(
      studentVisibilityOverrideWriteRefusal({
        apply: true,
        environment: 'development',
        env: { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' },
      }),
    ).toBeNull();
  });
});

describe('planStudentVisibilityOverride', () => {
  it('sets the tier and appends the reason, keeping other reason entries', () => {
    const decision = planStudentVisibilityOverride(
      {
        studentVisibilityTier: 'student_ready',
        studentVisibilitySuppressionReason: 'research_infrastructure_only',
      },
      { kind: 'set', tier: 'suppressed' },
      REASON,
    );
    expect(decision).toMatchObject({
      action: 'write',
      set: {
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: `research_infrastructure_only, ${REASON}`,
      },
      before: { tier: 'student_ready', overrideTier: null },
    });
  });

  it('replaces an earlier entry with the same code and is a no-op when already recorded', () => {
    const stored = {
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
    };
    expect(
      planStudentVisibilityOverride(stored, { kind: 'set', tier: 'suppressed' }, REASON),
    ).toMatchObject({ action: 'skip', reason: 'already_recorded' });
    const revised = planStudentVisibilityOverride(
      stored,
      { kind: 'set', tier: 'suppressed' },
      'umbrella_center_subunits_discoverable: revised evidence',
    );
    expect(revised).toMatchObject({
      action: 'write',
      set: {
        studentVisibilitySuppressionReason:
          'umbrella_center_subunits_discoverable: revised evidence',
      },
    });
  });

  it('clears the tier and only the entry carrying the same code', () => {
    const decision = planStudentVisibilityOverride(
      {
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: `permanently_closed: moved away, ${REASON}`,
      },
      { kind: 'clear' },
      'umbrella_center_subunits_discoverable: owner reversed the hold',
    );
    expect(decision).toMatchObject({
      action: 'write',
      set: { studentVisibilitySuppressionReason: 'permanently_closed: moved away' },
      unset: { studentVisibilityOverrideTier: '' },
    });
  });

  it('skips a clear with nothing to clear and a row whose reason field is locked', () => {
    expect(planStudentVisibilityOverride({}, { kind: 'clear' }, REASON)).toMatchObject({
      action: 'skip',
      reason: 'no_override_to_clear',
    });
    expect(
      planStudentVisibilityOverride(
        { manuallyLockedFields: ['studentVisibilitySuppressionReason'] },
        { kind: 'set', tier: 'suppressed' },
        REASON,
      ),
    ).toMatchObject({ action: 'skip', reason: 'suppression_reason_locked' });
  });
});
