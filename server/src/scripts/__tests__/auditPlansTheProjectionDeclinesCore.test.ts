import { describe, expect, it } from 'vitest';
import {
  comparePlannedFieldToProjection,
  summarizePlanAudit,
  verdictForScript,
} from '../auditPlansTheProjectionDeclinesCore';

describe('comparePlannedFieldToProjection', () => {
  // A field absent from `plannedSet` is a DECLINE, not a match: the projection writes only
  // what it resolved, so an absent field leaves the stored value standing and the script's
  // value never arrives from evidence (#3362).
  it('declines a field the projection does not plan at all', () => {
    expect(
      comparePlannedFieldToProjection({ entityKey: 'a', field: 'name', plannedValue: 'X' }, {}),
    ).toEqual({ reproduced: false, reason: 'not-in-planned-set' });
    expect(
      comparePlannedFieldToProjection(
        { entityKey: 'a', field: 'name', plannedValue: 'X' },
        undefined,
      ),
    ).toEqual({ reproduced: false, reason: 'not-in-planned-set' });
  });

  it('declines a field the projection plans differently', () => {
    expect(
      comparePlannedFieldToProjection(
        { entityKey: 'a', field: 'name', plannedValue: 'X' },
        {
          name: 'Y',
        },
      ),
    ).toEqual({ reproduced: false, reason: 'planned-set-differs' });
  });

  it('reproduces a field the projection plans identically, including a list', () => {
    expect(
      comparePlannedFieldToProjection(
        { entityKey: 'a', field: 'name', plannedValue: 'X' },
        {
          name: 'X',
        },
      ),
    ).toEqual({ reproduced: true });
    expect(
      comparePlannedFieldToProjection(
        { entityKey: 'a', field: 'departments', plannedValue: ['A', 'B'] },
        { departments: ['A', 'B'] },
      ),
    ).toEqual({ reproduced: true });
  });

  // A planned `undefined` and an absent key are different things, and only the latter is an
  // absence. A present key holding null must compare as a value.
  it('treats a planned null as a value rather than an absence', () => {
    expect(
      comparePlannedFieldToProjection(
        { entityKey: 'a', field: 'canonicalGroupId', plannedValue: null },
        { canonicalGroupId: null },
      ),
    ).toEqual({ reproduced: true });
  });
});

describe('verdictForScript', () => {
  // Three verdicts, never two. Collapsing `no-rows-planned` into either other is how a spent
  // script and a wrong one get the same treatment, and both were deleted this week for
  // opposite reasons.
  it('separates inert from harmless from wrong', () => {
    expect(verdictForScript({ planned: 0, declined: 0 })).toBe('no-rows-planned');
    expect(verdictForScript({ planned: 5, declined: 0 })).toBe('reproduces');
    expect(verdictForScript({ planned: 5, declined: 1 })).toBe('declines');
  });

  // A script the audit cannot dry-run is an unknown, never a pass.
  it('reports an unevaluable script as unknown rather than as passing', () => {
    expect(verdictForScript({ planned: 0, declined: 0, unknownReason: 'no pure planner' })).toBe(
      'unknown',
    );
  });

  it('a single declining row condemns the script, because it would corrupt that row', () => {
    expect(verdictForScript({ planned: 100, declined: 1 })).toBe('declines');
  });
});

describe('summarizePlanAudit', () => {
  it('counts every verdict, including the ones at zero', () => {
    expect(
      summarizePlanAudit([
        { script: 'a', verdict: 'declines', planned: 1, declined: 1, reproduced: 0 },
        { script: 'b', verdict: 'unknown', planned: 0, declined: 0, reproduced: 0 },
      ]),
    ).toEqual({ declines: 1, reproduces: 0, 'no-rows-planned': 0, unknown: 1 });
  });
});
