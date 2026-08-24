import { describe, expect, it } from 'vitest';
import { summarizeSchoolDepartmentDebt } from '../../../../data-migration/auditSchoolWithoutDepartment';

describe('summarizeSchoolDepartmentDebt', () => {
  it('counts only school-bearing entities that lack a department below the school', () => {
    const summary = summarizeSchoolDepartmentDebt([
      { slug: 'a', school: 'Yale School of Management', departments: [] },
      { slug: 'b', school: 'Yale School of Management', departments: ['Finance'] },
      { slug: 'c', school: 'Yale School of Medicine', departments: ['Yale School of Medicine'] },
      { slug: 'd', departments: [] },
    ]);
    expect(summary.totalConsidered).toBe(4);
    expect(summary.flagged).toBe(2);
    const bySchool = new Map(summary.bySchool.map((row) => [row.school, row.count]));
    expect(bySchool.get('Yale School of Management')).toBe(1);
    expect(bySchool.get('Yale School of Medicine')).toBe(1);
  });

  it('sorts schools by descending debt and caps samples', () => {
    const rows = Array.from({ length: 12 }, (_v, i) => ({
      slug: `env-${i}`,
      schools: ['Yale School of the Environment'],
      departments: [],
    }));
    rows.push({ slug: 'som-1', schools: ['Yale School of Management'], departments: [] });
    const summary = summarizeSchoolDepartmentDebt(rows);
    expect(summary.bySchool[0].school).toBe('Yale School of the Environment');
    expect(summary.bySchool[0].samples.length).toBeLessThanOrEqual(8);
  });
});
