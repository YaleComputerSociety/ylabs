/**
 * departments:audit-catalog-drift - reconciles the curated `DEFAULT_DEPT_CONFIGS`
 * roster map against Yale's own published A-Z department catalog (#2682).
 *
 * `DEFAULT_DEPT_CONFIGS` is the authority the rest of the catalog derives from
 * (`org-units:seed-catalog-gaps` only adds an OrgUnit row a roster config already
 * justifies), but nothing checked it against Yale's org chart, so a department Yale
 * adds, renames or retires drifted silently.
 *
 * Read-only: touches no database. Emits machine-readable JSON and a non-zero exit
 * code when a drift bucket is non-empty, so it can run unattended instead of
 * depending on somebody reading the page by hand.
 *
 *   yarn --cwd server departments:audit-catalog-drift
 *   yarn --cwd server departments:audit-catalog-drift --probe-configs
 *   yarn --cwd server departments:audit-catalog-drift --output=./tmp/catalog-drift.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_DEPT_CONFIGS } from '../scrapers/sources/departmentRosterScraper';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { checkSourceLinkHealth } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  DEPARTMENT_CATALOG_DRIFT_ALARM_EXIT_CODE,
  DEPARTMENT_CATALOG_URL,
  MIN_EXPECTED_CATALOG_ROWS,
  parseDepartmentCatalog,
  reconcileDepartmentCatalog,
  summarizeRosterConfigs,
  type RosterUrlProbe,
} from './auditDepartmentCatalogDriftCore';

export interface DepartmentCatalogDriftOptions {
  output?: string;
  probeConfigs: boolean;
}

export function parseDepartmentCatalogDriftArgs(argv: string[]): DepartmentCatalogDriftOptions {
  let output: string | undefined;
  let probeConfigs = false;
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--probe-configs') {
      probeConfigs = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { output, probeConfigs };
}

async function probeRosterUrls(
  configs: { deptKey: string; url: string }[],
): Promise<RosterUrlProbe[]> {
  const probes: RosterUrlProbe[] = [];
  const seen = new Set<string>();
  for (const config of configs) {
    if (seen.has(config.url)) continue;
    seen.add(config.url);
    try {
      const health = await checkSourceLinkHealth(config.url);
      probes.push({
        deptKey: config.deptKey,
        url: config.url,
        status: health.healthStatus,
        httpStatusCode: health.httpStatusCode,
      });
    } catch (error) {
      probes.push({
        deptKey: config.deptKey,
        url: config.url,
        status: 'UNKNOWN',
        error: String(sanitizeLogValue(error)),
      });
    }
  }
  return probes;
}

async function main() {
  const options = parseDepartmentCatalogDriftArgs(process.argv.slice(2));
  const page = await fetchPageWithPolicy(DEPARTMENT_CATALOG_URL);
  const catalog = parseDepartmentCatalog(page.html);
  if (catalog.length < MIN_EXPECTED_CATALOG_ROWS) {
    throw new Error(
      `Parsed only ${catalog.length} departments from the Yale A-Z catalog, below the ${MIN_EXPECTED_CATALOG_ROWS}-row floor; treat this as page drift rather than a shrinking university.`,
    );
  }

  const configs = summarizeRosterConfigs(DEFAULT_DEPT_CONFIGS);
  const probes = options.probeConfigs ? await probeRosterUrls(configs) : [];
  const report = reconcileDepartmentCatalog(catalog, configs, { probes });

  const output = { mode: 'audit', probedConfigs: options.probeConfigs, ...report };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }

  if (report.status === 'drift') {
    process.exitCode = DEPARTMENT_CATALOG_DRIFT_ALARM_EXIT_CODE;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main().catch((error) => {
    console.error('Failed to audit department catalog drift:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
