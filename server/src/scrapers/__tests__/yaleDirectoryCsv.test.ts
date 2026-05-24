import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import {
  directoryCsvRowToObservations,
  parseDirectoryCsv,
  YaleDirectoryCsvScraper,
} from '../sources/yaleDirectoryCsv';
import type { ObservationInput, ScraperContext } from '../types';

function buildContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'yale-directory-csv',
    sourceWeight: 0.45,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (input) => {
      emitted.push(...(Array.isArray(input) ? input : [input]));
    },
    log: (msg) => logs.push(msg),
  };
  return { ctx, emitted, logs };
}

describe('parseDirectoryCsv', () => {
  it('parses quoted names and preserves blank fields', () => {
    const rows = parseDirectoryCsv(
      'netid,name,first_name,last_name,title,department,department_unit,school,school_code,location\n' +
        'aa222,"Example, Morgan",Morgan,Example,Senior Administrative Assistant,MED School of Medicine,MEDINT Rheumatology,MED School of Medicine,,Fixture Center\n' +
        'aa2225,"Sample, Riley",Riley,Sample,,,,,,\n',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Example, Morgan');
    expect(rows[0].schoolCode).toBe('');
    expect(rows[1].title).toBe('');
    expect(rows[1].department).toBe('');
  });
});

describe('directoryCsvRowToObservations', () => {
  it('emits user observations only for AUTO_RESEARCH_PERSON rows and never email or phone', () => {
    const autoObs = directoryCsvRowToObservations({
      netid: 'hist01',
      name: 'Historian, Avery',
      firstName: 'Avery',
      lastName: 'Historian',
      title: 'Assistant Professor of History',
      department: 'FASHIS History',
      departmentUnit: 'FASHIS History',
      school: 'Faculty of Arts and Sciences',
      schoolCode: 'FAS',
      physicalLocation: 'HQ',
    });
    const suppressedObs = directoryCsvRowToObservations({
      netid: 'ops01',
      name: 'Worker, Casey',
      firstName: 'Casey',
      lastName: 'Worker',
      title: 'Custodian',
      department: 'Facilities',
      departmentUnit: 'Facilities Operations',
      school: '',
      schoolCode: '',
      physicalLocation: '',
    });

    expect(autoObs.length).toBeGreaterThan(0);
    expect(autoObs.every((obs) => obs.entityType === 'user')).toBe(true);
    expect(autoObs.every((obs) => obs.entityKey === 'hist01')).toBe(true);
    expect(autoObs.map((obs) => obs.field)).toEqual(
      expect.arrayContaining([
        'netid',
        'fname',
        'lname',
        'userType',
        'title',
        'primaryDepartment',
        'secondaryDepartments',
        'school',
        'physicalLocation',
        'dataSources',
      ]),
    );
    expect(autoObs.map((obs) => obs.field)).not.toContain('email');
    expect(autoObs.map((obs) => obs.field)).not.toContain('phone');
    expect(suppressedObs).toEqual([]);
  });
});

describe('YaleDirectoryCsvScraper.run', () => {
  it('treats a missing temporary CSV file as a gated no-op', async () => {
    const scraper = new YaleDirectoryCsvScraper({
      csvPath: path.join(os.tmpdir(), `ylabs-missing-directory-${Date.now()}.csv`),
    });
    const { ctx, emitted, logs } = buildContext({ dryRun: false });

    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
    expect(result.notes).toMatch(/not present/i);
    expect(logs.join('\n')).toMatch(/not present/i);
    expect(result.metrics).toMatchObject({
      yaleDirectoryCsv: {
        totalRows: 0,
        autoResearchPerson: 0,
        reviewResearchAdjacent: 0,
        identityOnly: 0,
        suppressNoise: 0,
      },
    });
  });

  it('returns bucket metrics, title samples, and emits only auto-research rows', async () => {
    const scraper = new YaleDirectoryCsvScraper({
      csvText:
        'netid,name,first_name,last_name,title,department,department_unit,school,school_code,location\n' +
        'hist01,"Historian, Avery",Avery,Historian,Assistant Professor of History,FASHIS History,FASHIS History,Faculty of Arts and Sciences,FAS,HQ\n' +
        'crc01,"Coordinator, Robin",Robin,Coordinator,Clinical Research Coordinator 2,MED Internal Medicine,MEDINT Rheumatology,MED School of Medicine,MED,Clinic\n' +
        'ops01,"Worker, Casey",Casey,Worker,Custodian,Facilities,Facilities Operations,,,Plant\n',
    });
    const { ctx, emitted } = buildContext({ dryRun: false });

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(emitted.every((obs) => obs.entityType === 'user')).toBe(true);
    expect(new Set(emitted.map((obs) => obs.entityKey))).toEqual(new Set(['hist01']));
    expect(result.metrics).toMatchObject({
      yaleDirectoryCsv: {
        totalRows: 3,
        autoResearchPerson: 1,
        reviewResearchAdjacent: 1,
        identityOnly: 0,
        suppressNoise: 1,
      },
    });
    expect((result.metrics as any).yaleDirectoryCsv.topReasons[0]).toHaveProperty('reason');
    expect((result.metrics as any).yaleDirectoryCsv.titlesByDecision.AUTO_RESEARCH_PERSON).toContain(
      'Assistant Professor of History',
    );
  });
});
