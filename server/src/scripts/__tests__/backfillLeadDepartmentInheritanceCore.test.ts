import { describe, expect, it } from 'vitest';
import { summarizeLeadDepartmentInheritance } from '../backfillLeadDepartmentInheritanceCore';
import { parseLeadDepartmentBackfillArgs } from '../backfillLeadDepartmentInheritance';

describe('summarizeLeadDepartmentInheritance', () => {
  it('separates the skip reasons instead of reporting one unchanged total', () => {
    const summary = summarizeLeadDepartmentInheritance([
      {
        id: '1',
        result: { inherited: true, school: 'School of Medicine', departments: ['Surgery'] },
      },
      {
        id: '2',
        result: { inherited: true, school: 'School of Medicine', departments: ['Surgery'] },
      },
      { id: '3', result: { inherited: false, skipped: 'no-department' } },
      { id: '4', result: { inherited: false, skipped: 'no-department' } },
      { id: '5', result: { inherited: false, skipped: 'no-single-lead' } },
      { id: '6', result: { inherited: false } },
    ]);
    expect(summary.scanned).toBe(6);
    expect(summary.inherited).toBe(2);
    expect(summary.skipped).toEqual({ 'no-department': 2, 'no-single-lead': 1, unknown: 1 });
    expect(summary.departmentsWritten).toEqual([['Surgery', 2]]);
    expect(summary.schoolsWritten).toEqual([['School of Medicine', 2]]);
  });

  it('ranks written departments by count, then by name', () => {
    const summary = summarizeLeadDepartmentInheritance([
      { id: '1', result: { inherited: true, departments: ['Neurology'] } },
      { id: '2', result: { inherited: true, departments: ['Surgical Oncology', 'Surgery'] } },
      { id: '3', result: { inherited: true, departments: ['Surgery'] } },
    ]);
    expect(summary.departmentsWritten).toEqual([
      ['Surgery', 2],
      ['Neurology', 1],
      ['Surgical Oncology', 1],
    ]);
  });
});

describe('parseLeadDepartmentBackfillArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseLeadDepartmentBackfillArgs([])).toEqual({ dryRun: true, confirmed: false });
  });

  it('reads apply, confirmation and limit', () => {
    expect(
      parseLeadDepartmentBackfillArgs(['--apply', '--confirm-lead-department', '--limit=25']),
    ).toEqual({ dryRun: false, confirmed: true, limit: 25 });
  });

  it('refuses an unknown flag and a non-numeric limit', () => {
    expect(() => parseLeadDepartmentBackfillArgs(['--nope'])).toThrow('Unknown argument');
    expect(() => parseLeadDepartmentBackfillArgs(['--limit=0'])).toThrow('positive integer');
  });
});
