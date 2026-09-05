import { describe, expect, it } from 'vitest';
import { auditDepartmentFacetCatalog } from '../auditDepartmentFacetCatalogCore';

const orgUnits = [
  { slug: 'internal-medicine', name: 'Internal Medicine', kind: 'DEPARTMENT' as const },
  { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' as const },
];

describe('auditDepartmentFacetCatalog', () => {
  it('ranks canonical facet values and uncataloged labels by served rows', () => {
    const audit = auditDepartmentFacetCatalog(
      [
        {
          departments: ['Internal Medicine'],
          orgAffiliationLabels: ['Yale Medicine', 'Yale New Haven Health System'],
        },
        { departments: ['Internal Medicine'], orgAffiliationLabels: ['Yale Medicine'] },
        { departments: [], orgAffiliationLabels: ['Janeway Society'] },
      ],
      orgUnits,
    );
    expect(audit.servedRows).toBe(3);
    expect(audit.canonicalFacetValues).toEqual([{ label: 'Internal Medicine', servedRows: 2 }]);
    expect(audit.uncatalogedLabels).toEqual([
      { label: 'Yale Medicine', servedRows: 2 },
      { label: 'Janeway Society', servedRows: 1 },
      { label: 'Yale New Haven Health System', servedRows: 1 },
    ]);
    expect(audit.rowsWithNoCanonicalDepartment).toBe(1);
  });

  it('excludes a label that a later catalog row made resolvable, so the debt list shrinks', () => {
    const entities = [{ departments: [], orgAffiliationLabels: ['General Internal Medicine'] }];
    expect(auditDepartmentFacetCatalog(entities, orgUnits).uncatalogedLabels).toEqual([
      { label: 'General Internal Medicine', servedRows: 1 },
    ]);
    const withSection = [
      ...orgUnits,
      {
        slug: 'general-internal-medicine',
        name: 'General Internal Medicine',
        kind: 'DEPARTMENT' as const,
      },
    ];
    expect(auditDepartmentFacetCatalog(entities, withSection).uncatalogedLabels).toEqual([]);
  });

  it('ignores blank and non-string values', () => {
    const audit = auditDepartmentFacetCatalog(
      [{ departments: ['  ', 7], orgAffiliationLabels: ['', null, ' Yale Ventures '] }] as never,
      orgUnits,
    );
    expect(audit.canonicalFacetValues).toEqual([]);
    expect(audit.uncatalogedLabels).toEqual([{ label: 'Yale Ventures', servedRows: 1 }]);
    expect(audit.rowsWithNoCanonicalDepartment).toBe(1);
  });
});
