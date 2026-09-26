import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  assertLeadPiInheritanceObservations,
  LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
} from '../../scrapers/entityMaterializer';
import { ACTIVE_SOURCE_NAMES } from '../../scrapers/seedSources';
import { sourceCoverageRegistry } from '../../scrapers/sourceCoverageRegistry';
import { scriptDrivenSourceOwner } from '../../scrapers/sourceDispatch';
import {
  planLeadPiProvenanceReback,
  summarizeLeadDepartmentInheritance,
} from '../backfillLeadDepartmentInheritanceCore';
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

describe('lead-PI inheritance is a registered, observation-backed lane', () => {
  // The lane stamped `fieldProvenance.school` and `fieldProvenance.departments` with a
  // sourceName that existed in no registry, so 110 served rows cited a lane that did
  // not exist and no observation asserted the value (#3362).
  it('registers the lane in the seed, the coverage registry, and the dispatch registry', () => {
    expect(ACTIVE_SOURCE_NAMES).toContain(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
    expect(Object.keys(sourceCoverageRegistry)).toContain(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
    expect(scriptDrivenSourceOwner(LEAD_PI_SCHOOL_INHERITANCE_SOURCE)).toBeTruthy();
  });

  it('declares a dispatch owner that names a real npm script', () => {
    const owner = scriptDrivenSourceOwner(LEAD_PI_SCHOOL_INHERITANCE_SOURCE)!;
    const manifest = JSON.parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json'),
        'utf8',
      ),
    ) as { scripts?: Record<string, string> };
    expect(Object.keys(manifest.scripts ?? {})).toContain(owner.replace('yarn --cwd server ', ''));
  });

  it('asserts exactly the fields it writes, and reports a missing Source instead of throwing', async () => {
    const appended: unknown[] = [];
    const observed = await assertLeadPiInheritanceObservations(
      '000000000000000000000001',
      { school: 'School of Medicine' },
      {
        getSource: async () => null,
        append: async (inputs) => {
          appended.push(inputs);
          return { inserted: inputs.length, skipped: 0, superseded: 0 };
        },
      },
    );
    expect(observed).toEqual({ observationSkipped: 'source-not-registered' });
    expect(appended).toEqual([]);
  });

  it('asserts nothing when the pass wrote no org-unit field', async () => {
    expect(
      await assertLeadPiInheritanceObservations('000000000000000000000001', { departments: [] }),
    ).toEqual({});
  });
});

describe('planLeadPiProvenanceReback', () => {
  const rederived = { school: 'School of Medicine', department: 'Genetics' };

  it('backs a value the lane independently reproduces', () => {
    expect(
      planLeadPiProvenanceReback({
        field: 'school',
        storedValue: 'School of Medicine',
        rederived,
        alreadyObserved: false,
      }),
    ).toEqual({ field: 'school', verdict: 'reproduced', value: 'School of Medicine' });
    expect(
      planLeadPiProvenanceReback({
        field: 'departments',
        storedValue: ['Genetics', 'Cell Biology'],
        rederived,
        alreadyObserved: false,
      }),
    ).toEqual({ field: 'departments', verdict: 'reproduced', value: ['Genetics', 'Cell Biology'] });
  });

  // Asserting a stored value because it is stored manufactures evidence for a value
  // whose origin cannot be established, so a divergence is reported and never stamped.
  it('refuses to back a value that diverges from what the lane derives', () => {
    expect(
      planLeadPiProvenanceReback({
        field: 'school',
        storedValue: 'School of the Environment',
        rederived,
        alreadyObserved: false,
      }),
    ).toEqual({ field: 'school', verdict: 'value-diverged' });
    expect(
      planLeadPiProvenanceReback({
        field: 'departments',
        storedValue: ['Astronomy'],
        rederived,
        alreadyObserved: false,
      }),
    ).toEqual({ field: 'departments', verdict: 'value-diverged' });
  });

  it('reports a lead the lane can no longer resolve rather than backing it', () => {
    expect(
      planLeadPiProvenanceReback({
        field: 'departments',
        storedValue: ['Genetics'],
        rederived: {},
        alreadyObserved: false,
      }),
    ).toEqual({ field: 'departments', verdict: 'not-reproducible' });
  });

  it('leaves an already-observed field alone', () => {
    expect(
      planLeadPiProvenanceReback({
        field: 'school',
        storedValue: 'School of Medicine',
        rederived,
        alreadyObserved: true,
      }),
    ).toEqual({ field: 'school', verdict: 'already-observed' });
  });
});
