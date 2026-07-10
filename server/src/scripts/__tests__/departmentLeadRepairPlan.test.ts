import { describe, expect, it } from 'vitest';

import { parseDepartmentLeadRepairPlanArgs } from '../departmentLeadRepairPlan';

describe('departmentLeadRepairPlan CLI helpers', () => {
  it('constrains output and reviewed plan artifacts to safe JSON roots', () => {
    expect(
      parseDepartmentLeadRepairPlanArgs([
        '--slug=example-lab',
        '--output=/tmp/department-lead-plan.json',
        '--expect-plan=/tmp/reviewed-department-lead-plan.json',
      ]),
    ).toMatchObject({
      slugs: ['example-lab'],
      output: '/tmp/department-lead-plan.json',
      expectPlan: '/tmp/reviewed-department-lead-plan.json',
    });

    expect(() =>
      parseDepartmentLeadRepairPlanArgs(['--slug=example-lab', '--output=/etc/department-lead-plan.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseDepartmentLeadRepairPlanArgs(['--slug=example-lab', '--output=/tmp/department-lead-plan.txt']),
    ).toThrow(/--output must point to a \.json report file/);
    expect(() =>
      parseDepartmentLeadRepairPlanArgs(['--slug=example-lab', '--expect-plan=/etc/reviewed-plan.json']),
    ).toThrow(/--expect-plan must write under/);
  });
});
