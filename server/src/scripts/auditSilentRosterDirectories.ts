/**
 * roster:audit-silent-directories - warns on a `dept-faculty-roster` config that files its own
 * department as everyone's home although the page states no one's appointment and the people
 * it lists have first-hand departments elsewhere (#6299). The predicate and thresholds live in
 * `scrapers/silentRosterDirectories.ts`; a roster run names the silent pages it read and points
 * here, because the user-key join this check needs is too slow to run inside the lane.
 *
 * Read-only: it reads live observations and joins keys with the engine's user-key join. It
 * writes nothing and exits 0; a warning is a prompt to set `withholdsHomeDepartment`.
 *
 *   yarn --cwd server roster:audit-silent-directories
 *   yarn --cwd server roster:audit-silent-directories --output=./tmp/silent-directories.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, runScriptMain } from '../db/connections';
import { Observation } from '../models/observation';
import { userKeyResearcherJoins } from '../scrapers/entityMaterializer';
import { getOrgUnitCanonicalizer } from '../scrapers/orgUnitCanonicalization';
import { DEPT_FACULTY_ROSTER_SOURCE } from '../scrapers/rosterHomeDepartmentScreen';
import {
  FIRST_HAND_PRIMARY_DEPARTMENT_SOURCES,
  classifySilentDirectory,
  firstHandDisagrees,
  silentDirectoryWarnings,
  type RosterDisagreementTally,
} from '../scrapers/silentRosterDirectories';
import {
  DEFAULT_DEPT_CONFIGS,
  assertsHomeDepartment,
  type DeptConfig,
} from '../scrapers/sources/departmentRosterScraper';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { writeReportFileSync } from '../utils/reportFileWriter';

const JOIN_CONCURRENCY = 8;

export function parseSilentRosterDirectoriesArgs(argv: string[]): { output?: string } {
  let output: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--output=')) output = resolveSafeJsonReportOutputPath(arg.slice(9));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { output };
}

const pageKey = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export function configForReading(
  sourceUrl: string,
  configs: readonly DeptConfig[] = DEFAULT_DEPT_CONFIGS,
): DeptConfig | undefined {
  const page = pageKey(sourceUrl);
  const matchLength = (config: DeptConfig): number =>
    Math.max(
      ...[config.url, config.dataUrl]
        .filter((url): url is string => Boolean(url))
        .map(pageKey)
        .filter((root) => page === root || page.startsWith(`${root}/`))
        .map((root) => root.length),
      -1,
    );
  return configs
    .filter((config) => matchLength(config) >= 0)
    .sort((a, b) => matchLength(b) - matchLength(a))[0];
}

type RunReading = { entityKey: string; scrapeRunId?: unknown; sourceUrl: string };
type TitleReading = RunReading & { value?: unknown; extraction?: { source?: string } };

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

const runKey = (reading: RunReading): string =>
  `${reading.entityKey}|${String(reading.scrapeRunId)}`;

const profileScope = (reading: RunReading): string =>
  `${runKey(reading)}|host:${hostOf(reading.sourceUrl)}`;

export function titledScopes(
  titles: readonly TitleReading[],
  configs: readonly DeptConfig[] = DEFAULT_DEPT_CONFIGS,
): Set<string> {
  const scopes = new Set<string>();
  for (const title of titles) {
    if (!String(title.value ?? '').trim()) continue;
    if (title.extraction?.source === 'profileTitleBlock') {
      scopes.add(profileScope(title));
      continue;
    }
    const config = configForReading(title.sourceUrl, configs);
    if (config) scopes.add(`${runKey(title)}|${config.deptKey}`);
  }
  return scopes;
}

export function membershipIsTitled(
  membership: RunReading,
  config: DeptConfig,
  scopes: ReadonlySet<string>,
): boolean {
  return (
    scopes.has(`${runKey(membership)}|${config.deptKey}`) || scopes.has(profileScope(membership))
  );
}

async function joinKeys(keys: string[]): Promise<Map<string, string | undefined>> {
  const joined = new Map<string, string | undefined>();
  let next = 0;
  await Promise.all(
    Array.from({ length: JOIN_CONCURRENCY }, async () => {
      while (next < keys.length) {
        const key = keys[next++];
        joined.set(key, (await userKeyResearcherJoins(key)).joinedResearcherId);
      }
    }),
  );
  return joined;
}

export async function auditSilentRosterDirectories(): Promise<{
  tallies: Array<RosterDisagreementTally & { class: string }>;
  warnings: string[];
  unmappedReadings: number;
}> {
  const memberships = (await Observation.find({
    sourceName: DEPT_FACULTY_ROSTER_SOURCE,
    entityType: 'user',
    field: 'departments',
    superseded: false,
  })
    .select('entityKey sourceUrl scrapeRunId')
    .lean()) as RunReading[];
  const titles = (await Observation.find({
    sourceName: DEPT_FACULTY_ROSTER_SOURCE,
    entityType: 'user',
    field: 'title',
    superseded: false,
  })
    .select('entityKey scrapeRunId sourceUrl value extraction.source')
    .lean()) as TitleReading[];
  const firstHand = (await Observation.find({
    entityType: 'user',
    field: 'primaryDepartment',
    superseded: false,
    sourceName: { $in: [...FIRST_HAND_PRIMARY_DEPARTMENT_SOURCES] },
  })
    .select('entityKey value')
    .lean()) as Array<{ entityKey: string; value?: unknown }>;

  const titled = titledScopes(titles);
  const joined = await joinKeys([
    ...new Set([...memberships, ...firstHand].map((reading) => reading.entityKey)),
  ]);
  const unitsByResearcher = new Map<string, string[]>();
  for (const reading of firstHand) {
    const researcherId = joined.get(reading.entityKey);
    if (!researcherId) continue;
    unitsByResearcher.set(researcherId, [
      ...(unitsByResearcher.get(researcherId) ?? []),
      String(reading.value),
    ]);
  }
  const canonicalizer = await getOrgUnitCanonicalizer();
  const canonicalDepartment = (name: string) => {
    const result = canonicalizer.canonicalizeDepartments(name);
    return result.values.find((value) => !result.unmatched.includes(value));
  };

  const tallies = new Map<string, RosterDisagreementTally>();
  let unmappedReadings = 0;
  for (const membership of memberships) {
    const config = configForReading(membership.sourceUrl);
    if (!config) {
      unmappedReadings += 1;
      continue;
    }
    const tally = tallies.get(config.deptKey) ?? {
      deptKey: config.deptKey,
      assertsHomeDepartment: assertsHomeDepartment(config),
      entries: 0,
      untitled: 0,
      withFirstHand: 0,
      disagree: 0,
    };
    tally.entries += 1;
    if (!membershipIsTitled(membership, config, titled)) {
      tally.untitled += 1;
    }
    const researcherId = joined.get(membership.entityKey);
    const units = researcherId ? (unitsByResearcher.get(researcherId) ?? []) : [];
    if (units.length > 0) {
      tally.withFirstHand += 1;
      if (
        firstHandDisagrees({
          rosterDepartment: config.deptName,
          firstHandUnits: units,
          canonicalDepartment,
          parentDepartmentsFor: (name) => canonicalizer.parentDepartmentsFor(name),
        })
      ) {
        tally.disagree += 1;
      }
    }
    tallies.set(config.deptKey, tally);
  }
  const rows = [...tallies.values()].map((tally) => ({
    ...tally,
    class: classifySilentDirectory(tally),
  }));
  return { tallies: rows, warnings: silentDirectoryWarnings(rows), unmappedReadings };
}

async function main(): Promise<void> {
  const options = parseSilentRosterDirectoriesArgs(process.argv.slice(2));
  dotenv.config();
  await initializeConnections();
  const result = await auditSilentRosterDirectories();
  for (const deptKey of result.warnings) {
    console.warn(
      `WARN: ${deptKey} lists mostly untitled entries whose first-hand departments disagree, and still files its own department as each person's home; consider withholdsHomeDepartment (#6299).`,
    );
  }
  const byClass: Record<string, number> = {};
  for (const tally of result.tallies) byClass[tally.class] = (byClass[tally.class] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        configs: result.tallies.length,
        byClass,
        unmappedReadings: result.unmappedReadings,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    writeReportFileSync(
      options.output,
      JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2),
    );
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  void runScriptMain(main, {
    logFailure: (error) =>
      console.error('Failed to audit silent roster directories:', sanitizeLogValue(error)),
  });
}
