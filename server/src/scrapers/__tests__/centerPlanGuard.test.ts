import { describe, expect, it } from 'vitest';

import {
  resolveMaterializeCenterPlanGuard,
  type MaterializeCenterPlanDecision,
} from '../centerPlanGuard';

const guardOf = (decision: MaterializeCenterPlanDecision) =>
  'guard' in decision ? decision.guard : undefined;

const RUN_ID = '6a0000000000000000000001';
const OTHER_RUN_ID = '6a0000000000000000000002';

const planFile = (centerPlan: Record<string, unknown>) =>
  JSON.stringify({ runId: RUN_ID, centerPlan });

const dryRunPlan = (runId = RUN_ID) => ({ mode: 'plan', runId, centers: [] });

const developmentApply = (overrides: { fieldScoped?: boolean; expectCenterPlanPath?: string }) => ({
  runId: RUN_ID,
  environment: 'development' as const,
  dryRun: false,
  writes: true,
  fieldScoped: false,
  ...overrides,
});

const deps = (readPlanFile: (path: string) => Promise<string>) => ({
  runHasCenterRosterHealth: async () => true,
  readPlanFile,
});

describe('resolveMaterializeCenterPlanGuard holds an apply to a plan it can trust (#6348)', () => {
  it('enforces a dry-run plan of the same run', async () => {
    const decision = await resolveMaterializeCenterPlanGuard(
      developmentApply({ expectCenterPlanPath: '/tmp/plan.json' }),
      deps(async () => planFile(dryRunPlan())),
    );
    expect(decision.refusal).toBeUndefined();
    expect(guardOf(decision)?.mode).toBe('enforce');
  });

  it('refuses a plan written for another run', async () => {
    const decision = await resolveMaterializeCenterPlanGuard(
      developmentApply({ expectCenterPlanPath: '/tmp/plan.json' }),
      deps(async () => planFile(dryRunPlan(OTHER_RUN_ID))),
    );
    expect(guardOf(decision)).toBeUndefined();
    expect(decision.refusal).toContain(`is for run ${OTHER_RUN_ID}, not run ${RUN_ID}`);
  });

  it("refuses an apply's own enforce-mode report", async () => {
    const decision = await resolveMaterializeCenterPlanGuard(
      developmentApply({ expectCenterPlanPath: '/tmp/plan.json' }),
      deps(async () => planFile({ ...dryRunPlan(), mode: 'enforce' })),
    );
    expect(guardOf(decision)).toBeUndefined();
    expect(decision.refusal).toContain('is not from a dry run');
  });

  it('refuses an unreadable plan file and a plan file that is not JSON', async () => {
    const unreadable = await resolveMaterializeCenterPlanGuard(
      developmentApply({ expectCenterPlanPath: '/tmp/missing.json' }),
      deps(async () => {
        throw new Error('ENOENT: no such file or directory');
      }),
    );
    expect(guardOf(unreadable)).toBeUndefined();
    expect(unreadable.refusal).toContain('could not read /tmp/missing.json as JSON');

    const notJson = await resolveMaterializeCenterPlanGuard(
      developmentApply({ expectCenterPlanPath: '/tmp/plan.txt' }),
      deps(async () => 'centerPlan: not json'),
    );
    expect(guardOf(notJson)).toBeUndefined();
    expect(notJson.refusal).toContain('could not read /tmp/plan.txt as JSON');
  });

  it('lets an --only-fields apply of a center roster run proceed without a plan', async () => {
    const decision = await resolveMaterializeCenterPlanGuard(
      developmentApply({ fieldScoped: true }),
      deps(async () => planFile(dryRunPlan())),
    );
    expect(decision).toEqual({});
  });

  it('refuses --only-fields combined with --expect-center-plan', async () => {
    const decision = await resolveMaterializeCenterPlanGuard(
      developmentApply({ fieldScoped: true, expectCenterPlanPath: '/tmp/plan.json' }),
      deps(async () => planFile(dryRunPlan())),
    );
    expect(guardOf(decision)).toBeUndefined();
    expect(decision.refusal).toContain('cannot be combined with --only-fields');
  });
});
