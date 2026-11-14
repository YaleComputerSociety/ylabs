import { describe, expect, it } from 'vitest';

import type { ResolvedField } from '../confidenceResolver';
import {
  pooledDepartmentWithStatedSection,
  resolvePooledDepartment,
  type DepartmentSpecificityCatalog,
} from '../pooledDepartmentSpecificity';

const candidate = (value: string): ResolvedField => ({
  value,
  confidence: 0.5,
  contributingSources: ['fixture-lane'],
  hasConflict: false,
});

const ANCESTORS: Record<string, string[]> = {
  Surgery: [],
  'Internal Medicine': [],
  'Colon & Rectal Surgery': ['Surgery'],
  'Digestive Diseases': ['Internal Medicine'],
  Nephrology: ['Internal Medicine'],
  'Pelvic Floor Unit': ['Colon & Rectal Surgery', 'Surgery'],
};

const catalog: DepartmentSpecificityCatalog = {
  canonical: (name) => (name in ANCESTORS ? name : undefined),
  parentDepartmentsFor: (name) => ANCESTORS[name] ?? [],
};

describe('pooledDepartmentWithStatedSection', () => {
  it('keeps a stated section over the department it sits directly under', () => {
    const ranked = [candidate('Surgery'), candidate('Colon & Rectal Surgery')];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe(
      'Colon & Rectal Surgery',
    );
  });

  it('keeps the department when the section belongs to a different department', () => {
    const ranked = [candidate('Surgery'), candidate('Digestive Diseases')];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe('Surgery');
  });

  it('applies no rule without a catalog', () => {
    const ranked = [candidate('Surgery'), candidate('Colon & Rectal Surgery')];
    expect(pooledDepartmentWithStatedSection(ranked, null)?.value).toBe('Surgery');
  });

  it('keeps the winner when two sections of the department compete', () => {
    const ranked = [
      candidate('Internal Medicine'),
      candidate('Digestive Diseases'),
      candidate('Nephrology'),
    ];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe('Internal Medicine');
  });

  it('never prefers a value the catalog does not name', () => {
    const ranked = [candidate('Internal Medicine'), candidate('AIDS')];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe('Internal Medicine');
  });

  it('fires only for a department winner, never for a section winner', () => {
    const ranked = [candidate('Colon & Rectal Surgery'), candidate('Pelvic Floor Unit')];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe(
      'Colon & Rectal Surgery',
    );
  });

  it('leaves a section winner alone', () => {
    const ranked = [candidate('Colon & Rectal Surgery'), candidate('Surgery')];
    expect(pooledDepartmentWithStatedSection(ranked, catalog)?.value).toBe(
      'Colon & Rectal Surgery',
    );
  });
});

describe('resolvePooledDepartment', () => {
  const at = new Date('2026-11-12T00:00:00Z');
  const now = new Date('2026-11-13T00:00:00Z');
  const reading = (value: string, _id: string) => ({
    _id,
    value,
    sourceName: 'dept-faculty-roster',
    confidence: 0.7,
    observedAt: at,
  });

  it('breaks an exact tie the same way whatever order the readings arrive in', () => {
    const forward = [reading('Beta Studies', 'b'), reading('Alpha Studies', 'a')];
    const backward = [...forward].reverse();

    expect(resolvePooledDepartment(forward, null, now)?.value).toBe(
      resolvePooledDepartment(backward, null, now)?.value,
    );
  });
});
