import * as cheerio from 'cheerio';

export const DEPARTMENT_CATALOG_URL = 'https://www.yale.edu/academics/departments-programs';

export const DEPARTMENT_CATALOG_AREAS = [
  'Biological Sciences',
  'Engineering',
  'Health & Medicine',
  'Humanities',
  'Physical Sciences',
  'Social Sciences',
] as const;

export const MIN_EXPECTED_CATALOG_ROWS = 80;

export const DEPARTMENT_CATALOG_DRIFT_ALARM_EXIT_CODE = 2;

export interface CatalogDepartment {
  name: string;
  url: string;
  areas: string[];
}

export interface RosterConfigSummary {
  deptKey: string;
  deptName: string;
  url: string;
}

/**
 * `host-root` is the weak one: Yale links some multi-department hosts at their bare
 * root (Public Health to `ysph.yale.edu/`, Management to `som.yale.edu/`), so every
 * config on that host matches one catalog row. Such a row cannot tell one of those
 * configs from another, which is why a dead roster path under it is only visible
 * through `--probe-configs`.
 */
export type CatalogMatchReason =
  | 'covered-elsewhere'
  | 'sole-config-on-host'
  | 'host-root'
  | 'path'
  | 'name';

export interface CoveredCatalogDepartment extends CatalogDepartment {
  matchedBy: CatalogMatchReason;
  configKeys: string[];
  configNames: string[];
  coveredElsewhereBy?: string;
}

export interface UncoveredCatalogDepartment extends CatalogDepartment {
  knownReason?: string;
}

export interface RosterConfigWithoutCatalogRow extends RosterConfigSummary {
  expectedAbsentReason?: string;
}

export interface CatalogNameDrift {
  catalogName: string;
  catalogUrl: string;
  configKeys: string[];
  configNames: string[];
}

export interface RosterUrlProbe {
  deptKey: string;
  url: string;
  status: string;
  httpStatusCode?: number;
  error?: string;
}

export interface DeadRosterUrl extends RosterUrlProbe {
  knownReason?: string;
}

export interface DepartmentCatalogDriftReport {
  catalogUrl: string;
  catalogDepartments: number;
  rosterConfigs: number;
  coveredDepartments: CoveredCatalogDepartment[];
  uncoveredDepartments: UncoveredCatalogDepartment[];
  unexpectedlyUncoveredDepartments: UncoveredCatalogDepartment[];
  staleUncoveredBaselineEntries: string[];
  configsWithoutCatalogRow: RosterConfigWithoutCatalogRow[];
  configsUnexpectedlyAbsentFromCatalog: RosterConfigWithoutCatalogRow[];
  staleAbsentConfigAllowlistEntries: string[];
  staleCoveredElsewhereEntries: string[];
  nameDrift: CatalogNameDrift[];
  unknownCatalogAreas: string[];
  probedRosterUrls: RosterUrlProbe[];
  deadRosterUrls: DeadRosterUrl[];
  newlyDeadRosterUrls: DeadRosterUrl[];
  revivedRosterUrls: string[];
  status: 'clean' | 'drift';
}

export interface CoveredElsewhereEntry {
  sourceName: string;
  reason: string;
}

/**
 * Catalog rows whose faculty are acquired by a scraper other than
 * `dept-faculty-roster`, keyed by host plus first path segment. Without these the
 * audit would report a covered department as uncovered forever.
 */
export const COVERED_ELSEWHERE: Readonly<Record<string, CoveredElsewhereEntry>> = {
  'environment.yale.edu': {
    sourceName: 'yse-faculty-directory',
    reason:
      'School of the Environment faculty, including the Forest School, come from the YSE directory scraper rather than a roster config.',
  },
  'medicine.yale.edu/bbs': {
    sourceName: 'bbs-research-track',
    reason:
      'Biological & Biomedical Sciences and its tracks are acquired per research track by the BBS scraper.',
  },
};

/**
 * Catalog departments with no roster lane as of #2682, each with why it was left
 * alone. An entry here suppresses the alarm but not the report, so the uncovered
 * list stays visible while only genuinely new drift fails the run.
 *
 * Five interdisciplinary programmes left this list when they gained
 * `crossListedProgramme` roster lanes: a baselined department that is now covered
 * reads as `staleUncoveredBaselineEntries` and alarms the run, which would mask
 * the real roster drift the audit exists to surface.
 */
export const KNOWN_UNCOVERED_CATALOG_DEPARTMENTS: Readonly<Record<string, string>> = {
  'experimental pathology':
    'The catalog links the Pathology PhD-program page, medicine.yale.edu/pathology/training/graduateprogram/, which carries no profile links, so a config would fail closed; its training faculty are the Pathology department already covered by the ysm-pathology lane (#2682).',
  'investigative medicine':
    'medicine.yale.edu/investigativemedicine/people/ carries no profile links, so a config would fail closed (#2682).',
  'neuroscience interdepartmental program':
    'No roster path: medicine.yale.edu/inp/people/ answers 500 (#2682).',
  'european and russian studies':
    'MacMillan area-studies council; measured 0 net-new people, every affiliate is already covered by a home department (#2682).',
  'latin american studies': 'MacMillan area-studies council; measured 0 net-new people (#2682).',
  'modern middle east studies':
    'MacMillan area-studies council; measured 0 net-new people (#2682).',
};

/**
 * Roster configs that are legitimately absent from the A-Z catalog, keyed by
 * `deptKey`. The catalog lists degree-granting departments and programs, so a
 * center, a concentration, a whole school or a single lab will never appear.
 */
export const CONFIGS_EXPECTED_ABSENT_FROM_CATALOG: Readonly<Record<string, string>> = {
  'wright-lab': 'A Physics laboratory, not a department.',
  'stem-cell-center': 'A YSM center, not a degree-granting department.',
  'physician-associate-program': 'A YSM professional program, not a catalog department.',
  'west-campus': 'An institute cluster spanning departments.',
  yibs: 'An institute whose affiliates enrich their home departments.',
  divinity:
    'A school, listed by the catalog under Explore Our Schools rather than as a department.',
  art: 'A school, listed by the catalog under Explore Our Schools rather than as a department.',
  'school-of-music':
    'The School of Music roster; the catalog Music department entry points at yalemusic.yale.edu instead.',
  'ysm-biomedical-informatics-data-science':
    'A YSM department the A-Z catalog does not list among degree-granting departments.',
};

/**
 * Only `UNAVAILABLE` counts, matching the #2473 rule that 403/429/5xx/timeout are
 * inconclusive and never retire a link. `classifySourceLinkHealth` already folds
 * "2xx that landed on the bare host root" into `UNAVAILABLE`, which is how a
 * retired department roster page reads.
 */
const DEAD_PROBE_STATUSES: ReadonlySet<string> = new Set(['UNAVAILABLE']);

/**
 * A revival needs a positive verdict, not merely the absence of `UNAVAILABLE`:
 * `UNKNOWN` is what a 403, a 429 or a thrown probe produces, and reading that as
 * "the lane came back" would alarm every time Yale's WAF throttles the run.
 */
const REVIVED_PROBE_STATUSES: ReadonlySet<string> = new Set(['HEALTHY', 'REDIRECTED']);

/**
 * Roster URLs already known dead and tracked, keyed by the configured roster URL
 * rather than by `deptKey`, because `deptKey` is not unique: six School of
 * Management configs share `som`, so one entry would suppress five other lanes.
 * Suppresses the alarm so `--probe-configs` reports only NEW death, and goes
 * stale-loud when the URL starts resolving again.
 */
export const KNOWN_DEAD_ROSTER_URLS: Readonly<Record<string, string>> = {};

export function normalizeDepartmentName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());
  } catch {
    return [];
  }
}

function coveredElsewhereKeys(url: string): string[] {
  const host = normalizeHost(url);
  if (!host) return [];
  const segments = pathSegments(url);
  return segments.length > 0 ? [`${host}/${segments[0]}`, host] : [host];
}

function isPathPrefix(catalogSegments: string[], configSegments: string[]): boolean {
  if (catalogSegments.length === 0) return true;
  if (catalogSegments.length > configSegments.length) return false;
  return catalogSegments.every((segment, index) => segment === configSegments[index]);
}

function resolveCatalogHref(href: string): string {
  try {
    return new URL(href, DEPARTMENT_CATALOG_URL).toString();
  } catch {
    throw new Error(
      `Yale A-Z catalog row links an href the audit cannot resolve (${href}); treat this as page drift rather than reconciling against a URL that parses nowhere.`,
    );
  }
}

export function parseDepartmentCatalog(html: string): CatalogDepartment[] {
  const $ = cheerio.load(html);
  const departments: CatalogDepartment[] = [];
  $('article.department_item').each((_, element) => {
    const row = $(element);
    const link = row.find('a.department_item_link').first();
    const href = link.attr('href')?.trim();
    const name = link.text().replace(/\s+/g, ' ').trim();
    if (!href || !name) return;
    const areas = row
      .find('.department_item_cell_40')
      .first()
      .text()
      .split(',')
      .map((area) => area.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    departments.push({ name, url: resolveCatalogHref(href), areas });
  });
  if (departments.length === 0) {
    throw new Error(
      'Parsed 0 departments from the Yale A-Z catalog; the page markup changed and the audit cannot reconcile anything.',
    );
  }
  return departments;
}

export interface ReconcileDepartmentCatalogOptions {
  probes?: RosterUrlProbe[];
  coveredElsewhere?: Readonly<Record<string, CoveredElsewhereEntry>>;
  knownUncovered?: Readonly<Record<string, string>>;
  expectedAbsentConfigs?: Readonly<Record<string, string>>;
  knownDeadRosterUrls?: Readonly<Record<string, string>>;
}

export function reconcileDepartmentCatalog(
  catalog: CatalogDepartment[],
  configs: RosterConfigSummary[],
  options: ReconcileDepartmentCatalogOptions = {},
): DepartmentCatalogDriftReport {
  const {
    probes = [],
    coveredElsewhere = COVERED_ELSEWHERE,
    knownUncovered = KNOWN_UNCOVERED_CATALOG_DEPARTMENTS,
    expectedAbsentConfigs = CONFIGS_EXPECTED_ABSENT_FROM_CATALOG,
    knownDeadRosterUrls = KNOWN_DEAD_ROSTER_URLS,
  } = options;
  const configsByHost = new Map<string, RosterConfigSummary[]>();
  for (const config of configs) {
    const host = normalizeHost(config.url);
    if (!host) continue;
    const existing = configsByHost.get(host);
    if (existing) existing.push(config);
    else configsByHost.set(host, [config]);
  }
  const configsByNormalizedName = new Map<string, RosterConfigSummary[]>();
  for (const config of configs) {
    const key = normalizeDepartmentName(config.deptName);
    const existing = configsByNormalizedName.get(key);
    if (existing) existing.push(config);
    else configsByNormalizedName.set(key, [config]);
  }

  const covered: CoveredCatalogDepartment[] = [];
  const uncovered: UncoveredCatalogDepartment[] = [];
  const matchedConfigUrls = new Set<string>();
  const usedCoveredElsewhereKeys = new Set<string>();
  const nameDrift: CatalogNameDrift[] = [];
  const areasSeen = new Set<string>();

  for (const department of catalog) {
    for (const area of department.areas) areasSeen.add(area);

    const elsewhereKey = coveredElsewhereKeys(department.url).find(
      (key) => key in coveredElsewhere,
    );
    if (elsewhereKey) {
      usedCoveredElsewhereKeys.add(elsewhereKey);
      covered.push({
        ...department,
        matchedBy: 'covered-elsewhere',
        configKeys: [],
        configNames: [],
        coveredElsewhereBy: coveredElsewhere[elsewhereKey].sourceName,
      });
      continue;
    }

    const host = normalizeHost(department.url);
    const hostConfigs = host ? (configsByHost.get(host) ?? []) : [];
    const catalogSegments = pathSegments(department.url);
    let matchedBy: CatalogMatchReason | undefined;
    let matches: RosterConfigSummary[] = [];

    if (hostConfigs.length === 1) {
      matchedBy = 'sole-config-on-host';
      matches = hostConfigs;
    } else if (hostConfigs.length > 1 && catalogSegments.length === 0) {
      matchedBy = 'host-root';
      matches = hostConfigs;
    } else if (hostConfigs.length > 1) {
      const lastCatalogSegment = catalogSegments[catalogSegments.length - 1];
      matches = hostConfigs.filter((config) => {
        const configSegments = pathSegments(config.url);
        if (isPathPrefix(catalogSegments, configSegments)) return true;
        return lastCatalogSegment !== undefined && configSegments.includes(lastCatalogSegment);
      });
      if (matches.length > 0) matchedBy = 'path';
    }

    if (!matchedBy) {
      const byName = configsByNormalizedName.get(normalizeDepartmentName(department.name)) ?? [];
      if (byName.length > 0) {
        matchedBy = 'name';
        matches = byName;
      }
    }

    if (!matchedBy) {
      const knownReason = knownUncovered[normalizeDepartmentName(department.name)];
      uncovered.push(knownReason ? { ...department, knownReason } : { ...department });
      continue;
    }

    for (const match of matches) matchedConfigUrls.add(match.url);
    covered.push({
      ...department,
      matchedBy,
      configKeys: [...new Set(matches.map((match) => match.deptKey))].sort(),
      configNames: [...new Set(matches.map((match) => match.deptName))].sort(),
    });

    const catalogNameKey = normalizeDepartmentName(department.name);
    if (!matches.some((match) => normalizeDepartmentName(match.deptName) === catalogNameKey)) {
      nameDrift.push({
        catalogName: department.name,
        catalogUrl: department.url,
        configKeys: [...new Set(matches.map((match) => match.deptKey))].sort(),
        configNames: [...new Set(matches.map((match) => match.deptName))].sort(),
      });
    }
  }

  const configsWithoutCatalogRow: RosterConfigWithoutCatalogRow[] = configs
    .filter((config) => !matchedConfigUrls.has(config.url))
    .map((config) => {
      const expectedAbsentReason = expectedAbsentConfigs[config.deptKey];
      return expectedAbsentReason ? { ...config, expectedAbsentReason } : { ...config };
    });

  const catalogNameKeys = new Set(
    catalog.map((department) => normalizeDepartmentName(department.name)),
  );
  const uncoveredNameKeys = new Set(
    uncovered.map((department) => normalizeDepartmentName(department.name)),
  );
  const staleUncoveredBaselineEntries = Object.keys(knownUncovered)
    .filter((key) => !uncoveredNameKeys.has(key))
    .map((key) =>
      catalogNameKeys.has(key)
        ? `${key} (now covered by a roster config)`
        : `${key} (no longer in the catalog)`,
    )
    .sort();

  const configKeys = new Set(configs.map((config) => config.deptKey));
  const absentConfigKeys = new Set(configsWithoutCatalogRow.map((config) => config.deptKey));
  const staleAbsentConfigAllowlistEntries = Object.keys(expectedAbsentConfigs)
    .filter((key) => !absentConfigKeys.has(key))
    .map((key) =>
      configKeys.has(key)
        ? `${key} (now matches a catalog row)`
        : `${key} (no longer a roster config)`,
    )
    .sort();

  const staleCoveredElsewhereEntries = Object.keys(coveredElsewhere)
    .filter((key) => !usedCoveredElsewhereKeys.has(key))
    .sort();

  const unknownCatalogAreas = [...areasSeen]
    .filter((area) => !(DEPARTMENT_CATALOG_AREAS as readonly string[]).includes(area))
    .sort();

  const deadRosterUrls: DeadRosterUrl[] = probes
    .filter((probe) => DEAD_PROBE_STATUSES.has(probe.status))
    .map((probe) => {
      const knownReason = knownDeadRosterUrls[probe.url];
      return knownReason ? { ...probe, knownReason } : { ...probe };
    });
  const newlyDeadRosterUrls = deadRosterUrls.filter((probe) => probe.knownReason === undefined);
  const revivedProbeUrls = new Set(
    probes.filter((probe) => REVIVED_PROBE_STATUSES.has(probe.status)).map((probe) => probe.url),
  );
  const revivedRosterUrls = Object.keys(knownDeadRosterUrls)
    .filter((url) => revivedProbeUrls.has(url))
    .sort();

  const unexpectedlyUncoveredDepartments = uncovered.filter(
    (department) => department.knownReason === undefined,
  );
  const configsUnexpectedlyAbsentFromCatalog = configsWithoutCatalogRow.filter(
    (config) => config.expectedAbsentReason === undefined,
  );

  const drift =
    unexpectedlyUncoveredDepartments.length > 0 ||
    staleUncoveredBaselineEntries.length > 0 ||
    configsUnexpectedlyAbsentFromCatalog.length > 0 ||
    staleAbsentConfigAllowlistEntries.length > 0 ||
    staleCoveredElsewhereEntries.length > 0 ||
    unknownCatalogAreas.length > 0 ||
    newlyDeadRosterUrls.length > 0 ||
    revivedRosterUrls.length > 0;

  return {
    catalogUrl: DEPARTMENT_CATALOG_URL,
    catalogDepartments: catalog.length,
    rosterConfigs: configs.length,
    coveredDepartments: covered,
    uncoveredDepartments: uncovered,
    unexpectedlyUncoveredDepartments,
    staleUncoveredBaselineEntries,
    configsWithoutCatalogRow,
    configsUnexpectedlyAbsentFromCatalog,
    staleAbsentConfigAllowlistEntries,
    staleCoveredElsewhereEntries,
    nameDrift,
    unknownCatalogAreas,
    probedRosterUrls: probes,
    deadRosterUrls,
    newlyDeadRosterUrls,
    revivedRosterUrls,
    status: drift ? 'drift' : 'clean',
  };
}

export function summarizeRosterConfigs(
  configs: { deptKey: string; deptName: string; url: string }[],
): RosterConfigSummary[] {
  return configs.map(({ deptKey, deptName, url }) => ({ deptKey, deptName, url }));
}
