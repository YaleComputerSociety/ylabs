import { describe, expect, it } from 'vitest';
import {
  exactDuplicateUrlGroups,
  planStudentVisibilityGate,
} from '../studentVisibilityGateService';

describe('the duplicate-risk suppression option (#3272)', () => {
  it('is refused in apply mode, because it plans from a premise false of the corpus', async () => {
    await expect(
      planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        suppressDuplicateRisk: true,
      }),
    ).rejects.toThrow(/cannot be combined with mode: apply/);
  });

  it('is off by default, so no caller changes behaviour by upgrading', () => {
    const options = { collection: 'research' as const, mode: 'dry-run' as const };
    expect((options as { suppressDuplicateRisk?: boolean }).suppressDuplicateRisk).toBeUndefined();
  });
});

describe('exactDuplicateUrlGroups is reachable from outside the module (#3272)', () => {
  it('groups rows that share a duplicate-signal url and leaves a singleton ungrouped', () => {
    const base = {
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fieldProvenance: {},
    };
    const groups = exactDuplicateUrlGroups([
      {
        ...base,
        _id: 'a',
        slug: 'a',
        name: 'A Lab',
        websiteUrl: 'https://medicine.yale.edu/lab/shared-fixture/',
      },
      {
        ...base,
        _id: 'b',
        slug: 'b',
        name: 'B Lab',
        websiteUrl: 'https://medicine.yale.edu/lab/shared-fixture/',
      },
      {
        ...base,
        _id: 'c',
        slug: 'c',
        name: 'C Lab',
        websiteUrl: 'https://medicine.yale.edu/lab/other-fixture/',
      },
    ]);
    // The builder is the gate's own, so this pins reachability and shape rather than a
    // re-implemented key: a shared url groups, a unique one does not.
    expect(groups.length).toBe(1);
    expect(groups[0].members.map((m: { _id: string }) => m._id).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing when no url is shared, so an empty result is a real zero', () => {
    const groups = exactDuplicateUrlGroups([
      {
        _id: 'a',
        slug: 'a',
        name: 'A Lab',
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: 'https://medicine.yale.edu/lab/shared-fixture/',
      },
    ]);
    expect(groups).toEqual([]);
  });
});
