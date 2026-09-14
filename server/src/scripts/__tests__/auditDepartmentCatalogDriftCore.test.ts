import { describe, expect, it } from 'vitest';

import { DEFAULT_DEPT_CONFIGS } from '../../scrapers/sources/departmentRosterScraper';
import {
  CONFIGS_EXPECTED_ABSENT_FROM_CATALOG,
  COVERED_ELSEWHERE,
  KNOWN_DEAD_ROSTER_URLS,
  KNOWN_UNCOVERED_CATALOG_DEPARTMENTS,
  normalizeDepartmentName,
  parseDepartmentCatalog,
  reconcileDepartmentCatalog,
  summarizeRosterConfigs,
  type CatalogDepartment,
  type ReconcileDepartmentCatalogOptions,
  type RosterConfigSummary,
} from '../auditDepartmentCatalogDriftCore';

const catalogRow = (name: string, url: string, areas = 'Humanities'): string =>
  `<article class="department_item humanities">
     <div class="department_item_cell department_item_cell_60">
       <h4 class="department_item_heading">
         <a href="${url}" class="department_item_link">${name}</a>
       </h4>
     </div>
     <div class="department_item_cell department_item_cell_40">${areas}</div>
   </article>`;

const catalogPage = (...rows: string[]): string =>
  `<html><body><div class="departments">${rows.join('')}</div></body></html>`;

const config = (deptKey: string, deptName: string, url: string): RosterConfigSummary => ({
  deptKey,
  deptName,
  url,
});

const chemistry: CatalogDepartment = {
  name: 'Chemistry',
  url: 'https://chem.yale.edu/',
  areas: ['Physical Sciences'],
};
const chemistryConfig = config('chemistry', 'Chemistry', 'https://chem.yale.edu/people/faculty');

/**
 * Every suppression list defaults to empty so a fixture is judged on itself; a
 * test that cares about a baseline passes that baseline explicitly. Sharing the
 * module constants here instead would make each small fixture report the whole
 * real baseline as stale.
 */
const reconcile = (
  catalog: CatalogDepartment[],
  configs: RosterConfigSummary[],
  options: ReconcileDepartmentCatalogOptions = {},
) =>
  reconcileDepartmentCatalog(catalog, configs, {
    coveredElsewhere: {},
    knownUncovered: {},
    expectedAbsentConfigs: {},
    knownDeadRosterUrls: {},
    ...options,
  });

describe('parseDepartmentCatalog', () => {
  it('reads the name, url, and comma-separated areas of every catalog row', () => {
    const departments = parseDepartmentCatalog(
      catalogPage(
        catalogRow('Chemistry', 'https://chem.yale.edu/', 'Physical Sciences'),
        catalogRow(
          'Biological &amp; Biomedical Sciences',
          'https://medicine.yale.edu/bbs/',
          'Biological Sciences, Health &amp; Medicine',
        ),
      ),
    );
    expect(departments).toEqual<CatalogDepartment[]>([
      { name: 'Chemistry', url: 'https://chem.yale.edu/', areas: ['Physical Sciences'] },
      {
        name: 'Biological & Biomedical Sciences',
        url: 'https://medicine.yale.edu/bbs/',
        areas: ['Biological Sciences', 'Health & Medicine'],
      },
    ]);
  });

  it('throws rather than reporting every department uncovered when the markup changes', () => {
    expect(() =>
      parseDepartmentCatalog('<html><body><ul><li>Chemistry</li></ul></body></html>'),
    ).toThrow(/Parsed 0 departments/);
  });
});

describe('reconcileDepartmentCatalog matching', () => {
  it('matches a department to the only roster config on its host despite a deeper roster path', () => {
    const report = reconcile([chemistry], [chemistryConfig]);
    expect(report.status).toBe('clean');
    expect(report.coveredDepartments).toEqual([
      expect.objectContaining({ matchedBy: 'sole-config-on-host', configKeys: ['chemistry'] }),
    ]);
    expect(report.uncoveredDepartments).toEqual([]);
  });

  it('separates the two configs sharing a host by path rather than calling both a match', () => {
    const report = reconcile(
      [
        {
          name: 'Dermatology',
          url: 'https://medicine.yale.edu/dermatology/',
          areas: ['Health & Medicine'],
        },
      ],
      [
        config('ysm-dermatology', 'Dermatology', 'https://medicine.yale.edu/dermatology/people/'),
        config('ysm-urology', 'Urology', 'https://medicine.yale.edu/urology/faculty/'),
      ],
    );
    expect(report.coveredDepartments).toEqual([
      expect.objectContaining({ matchedBy: 'path', configKeys: ['ysm-dermatology'] }),
    ]);
    expect(report.configsWithoutCatalogRow).toEqual([
      expect.objectContaining({ deptKey: 'ysm-urology' }),
    ]);
  });

  it('falls back to the department name when the published url shares no path with the roster', () => {
    const report = reconcile(
      [
        {
          name: 'Environmental Health Sciences',
          url: 'https://ysph.yale.edu/research/',
          areas: ['Health & Medicine'],
        },
      ],
      [
        config(
          'ysph-environmental-health-sciences',
          'Environmental Health Sciences',
          'https://ysph.yale.edu/school-of-public-health-faculty/environmental-health-sciences/',
        ),
        config('ysph-biostatistics', 'Biostatistics', 'https://ysph.yale.edu/other/biostatistics/'),
      ],
    );
    expect(report.coveredDepartments).toEqual([
      expect.objectContaining({
        matchedBy: 'name',
        configKeys: ['ysph-environmental-health-sciences'],
      }),
    ]);
  });

  it('marks a bare-host catalog row as the weak host-root match it is', () => {
    const report = reconcile(
      [{ name: 'Public Health', url: 'https://ysph.yale.edu/', areas: ['Health & Medicine'] }],
      [
        config('ysph-a', 'Biostatistics', 'https://ysph.yale.edu/faculty/biostatistics/'),
        config('ysph-b', 'Global Health', 'https://ysph.yale.edu/faculty/global-health/'),
      ],
    );
    expect(report.coveredDepartments).toEqual([
      expect.objectContaining({ matchedBy: 'host-root', configKeys: ['ysph-a', 'ysph-b'] }),
    ]);
  });

  it('credits a department acquired by a scraper other than the roster lane', () => {
    const report = reconcile(
      [
        {
          name: 'Biological & Biomedical Sciences',
          url: 'https://medicine.yale.edu/bbs/',
          areas: ['Biological Sciences'],
        },
      ],
      [config('ysm-genetics', 'Genetics', 'https://medicine.yale.edu/genetics/people/')],
      {
        coveredElsewhere: {
          'medicine.yale.edu/bbs': {
            sourceName: 'bbs-research-track',
            reason: 'Acquired per research track by the BBS scraper rather than a roster config.',
          },
        },
      },
    );
    expect(report.coveredDepartments).toEqual([
      expect.objectContaining({
        matchedBy: 'covered-elsewhere',
        coveredElsewhereBy: 'bbs-research-track',
      }),
    ]);
    expect(report.staleCoveredElsewhereEntries).toEqual([]);
  });

  it('reports a name disagreement on a matched department without alarming', () => {
    const report = reconcile(
      [{ name: 'German', url: 'https://german.yale.edu/', areas: ['Humanities'] }],
      [
        config(
          'german',
          'Germanic Languages & Literatures',
          'https://german.yale.edu/people/faculty',
        ),
      ],
    );
    expect(report.nameDrift).toEqual([
      expect.objectContaining({
        catalogName: 'German',
        configNames: ['Germanic Languages & Literatures'],
      }),
    ]);
    expect(report.status).toBe('clean');
  });
});

describe('reconcileDepartmentCatalog alarms', () => {
  it('alarms on a catalog department that is neither covered nor baselined', () => {
    const report = reconcile(
      [{ name: 'Quantum Basketry', url: 'https://basketry.yale.edu/', areas: ['Humanities'] }],
      [chemistryConfig],
    );
    expect(report.status).toBe('drift');
    expect(report.unexpectedlyUncoveredDepartments).toEqual([
      expect.objectContaining({ name: 'Quantum Basketry' }),
    ]);
  });

  it('reports a baselined uncovered department without alarming', () => {
    const medieval: CatalogDepartment = {
      name: 'Medieval Studies',
      url: 'https://medieval.yale.edu/',
      areas: ['Humanities'],
    };
    const report = reconcile([medieval], [chemistryConfig], {
      knownUncovered: {
        'medieval studies': 'Cross-listed program with negligible net-new people.',
      },
    });
    expect(report.uncoveredDepartments).toEqual([
      expect.objectContaining({ name: 'Medieval Studies', knownReason: expect.any(String) }),
    ]);
    expect(report.unexpectedlyUncoveredDepartments).toEqual([]);
    expect(report.staleUncoveredBaselineEntries).toEqual([]);
  });

  it('alarms when a baselined uncovered department has since been covered', () => {
    const report = reconcile([chemistry], [chemistryConfig], {
      knownUncovered: { chemistry: 'Was uncovered when the baseline was written.' },
    });
    expect(report.staleUncoveredBaselineEntries).toEqual([
      'chemistry (now covered by a roster config)',
    ]);
    expect(report.status).toBe('drift');
  });

  it('alarms when a baselined uncovered department has left the catalog', () => {
    const report = reconcile([chemistry], [chemistryConfig], {
      knownUncovered: { 'medieval studies': 'Cross-listed program.' },
    });
    expect(report.staleUncoveredBaselineEntries).toEqual([
      'medieval studies (no longer in the catalog)',
    ]);
    expect(report.status).toBe('drift');
  });

  it('alarms when a roster config no longer appears in the catalog at all', () => {
    const report = reconcile(
      [chemistry],
      [
        chemistryConfig,
        config('retired-dept', 'Retired Studies', 'https://retired.yale.edu/people'),
      ],
    );
    expect(report.status).toBe('drift');
    expect(report.configsUnexpectedlyAbsentFromCatalog).toEqual([
      expect.objectContaining({ deptKey: 'retired-dept' }),
    ]);
  });

  it('reports an allowlisted absent config without alarming', () => {
    const report = reconcile(
      [chemistry],
      [chemistryConfig, config('wright-lab', 'Physics', 'https://wlab.yale.edu/people/faculty')],
      { expectedAbsentConfigs: { 'wright-lab': 'A laboratory rather than a department.' } },
    );
    expect(report.configsWithoutCatalogRow).toEqual([
      expect.objectContaining({ deptKey: 'wright-lab', expectedAbsentReason: expect.any(String) }),
    ]);
    expect(report.configsUnexpectedlyAbsentFromCatalog).toEqual([]);
    expect(report.status).toBe('clean');
  });

  it('alarms when an allowlisted absent config starts matching a catalog row', () => {
    const report = reconcile([chemistry], [chemistryConfig], {
      expectedAbsentConfigs: { chemistry: 'Was absent when the allowlist was written.' },
    });
    expect(report.staleAbsentConfigAllowlistEntries).toEqual([
      'chemistry (now matches a catalog row)',
    ]);
    expect(report.status).toBe('drift');
  });

  it('alarms when a covered-elsewhere entry matches no catalog row any more', () => {
    const report = reconcile([chemistry], [chemistryConfig], {
      coveredElsewhere: {
        'environment.yale.edu': {
          sourceName: 'yse-faculty-directory',
          reason: 'Acquired by the YSE directory scraper rather than a roster config.',
        },
      },
    });
    expect(report.staleCoveredElsewhereEntries).toEqual(['environment.yale.edu']);
    expect(report.status).toBe('drift');
  });

  it('alarms on an area outside the published vocabulary', () => {
    const report = reconcile([{ ...chemistry, areas: ['Alchemy'] }], [chemistryConfig]);
    expect(report.unknownCatalogAreas).toEqual(['Alchemy']);
    expect(report.status).toBe('drift');
  });
});

describe('reconcileDepartmentCatalog roster-url probes', () => {
  it('counts only an UNAVAILABLE probe as dead, so a 403 never retires a lane', () => {
    const inconclusive = reconcile([chemistry], [chemistryConfig], {
      probes: [
        { deptKey: 'chemistry', url: chemistryConfig.url, status: 'UNKNOWN', httpStatusCode: 403 },
      ],
    });
    expect(inconclusive.deadRosterUrls).toEqual([]);
    expect(inconclusive.status).toBe('clean');

    const gone = reconcile([chemistry], [chemistryConfig], {
      probes: [
        {
          deptKey: 'chemistry',
          url: chemistryConfig.url,
          status: 'UNAVAILABLE',
          httpStatusCode: 404,
        },
      ],
    });
    expect(gone.newlyDeadRosterUrls).toHaveLength(1);
    expect(gone.status).toBe('drift');
  });

  it('reports an already-tracked dead roster url without alarming, and alarms when it revives', () => {
    const knownDeadRosterUrls = { chemistry: 'Tracked separately as a moved roster.' };

    const stillDead = reconcile([chemistry], [chemistryConfig], {
      knownDeadRosterUrls,
      probes: [
        {
          deptKey: 'chemistry',
          url: chemistryConfig.url,
          status: 'UNAVAILABLE',
          httpStatusCode: 404,
        },
      ],
    });
    expect(stillDead.deadRosterUrls).toEqual([
      expect.objectContaining({ deptKey: 'chemistry', knownReason: expect.any(String) }),
    ]);
    expect(stillDead.newlyDeadRosterUrls).toEqual([]);
    expect(stillDead.status).toBe('clean');

    const revived = reconcile([chemistry], [chemistryConfig], {
      knownDeadRosterUrls,
      probes: [
        { deptKey: 'chemistry', url: chemistryConfig.url, status: 'HEALTHY', httpStatusCode: 200 },
      ],
    });
    expect(revived.revivedRosterUrls).toEqual(['chemistry']);
    expect(revived.status).toBe('drift');
  });

  it('stays silent about the dead-url baseline when nothing was probed', () => {
    const report = reconcile([chemistry], [chemistryConfig], {
      knownDeadRosterUrls: { chemistry: 'Tracked separately as a moved roster.' },
    });
    expect(report.revivedRosterUrls).toEqual([]);
    expect(report.status).toBe('clean');
  });
});

describe('normalizeDepartmentName', () => {
  it('folds the ampersand, punctuation, and case differences between the two catalogs', () => {
    expect(normalizeDepartmentName('Molecular, Cellular & Developmental Biology')).toBe(
      normalizeDepartmentName('Molecular, Cellular and Developmental Biology'),
    );
    expect(normalizeDepartmentName('U.S. Health Justice')).toBe('u s health justice');
  });
});

describe('checked-in baselines stay honest against the live roster map', () => {
  const configs = summarizeRosterConfigs(DEFAULT_DEPT_CONFIGS);

  it('names a real roster config in every deptKey-keyed baseline entry', () => {
    const deptKeys = new Set(configs.map((entry) => entry.deptKey));
    for (const deptKey of [
      ...Object.keys(CONFIGS_EXPECTED_ABSENT_FROM_CATALOG),
      ...Object.keys(KNOWN_DEAD_ROSTER_URLS),
    ]) {
      expect(deptKeys, `${deptKey} is baselined but is not a roster config`).toContain(deptKey);
    }
  });

  it('keys the known-uncovered baseline by an already-normalized department name', () => {
    for (const name of Object.keys(KNOWN_UNCOVERED_CATALOG_DEPARTMENTS)) {
      expect(normalizeDepartmentName(name)).toBe(name);
    }
  });

  it('gives every suppression entry a reason a reviewer can read', () => {
    const reasons = [
      ...Object.values(KNOWN_UNCOVERED_CATALOG_DEPARTMENTS),
      ...Object.values(CONFIGS_EXPECTED_ABSENT_FROM_CATALOG),
      ...Object.values(KNOWN_DEAD_ROSTER_URLS),
      ...Object.values(COVERED_ELSEWHERE).map((entry) => entry.reason),
    ];
    for (const reason of reasons) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
