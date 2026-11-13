import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(SERVER_ROOT, 'src', 'scripts');
const LANE_RUNNING_ENTRY_POINTS = ['src/scrapers/cli.ts', 'src/scripts/scrapeCanary.ts'];

const FETCHING_IMPORT =
  /from\s+['"]axios['"]|import\(\s*['"]axios['"]\s*\)|\b(?:fetchPageWithPolicy|postFormWithPolicy|checkSourceLinkHealth|probeSourceLink|fetchPublicHttpUrl)\b|['"][./]*(?:scrapers\/)?renderedFetch['"]/;
const LINK_HEALTH_IMPORT = /\b(?:checkSourceLinkHealth|probeSourceLink)\b/;
const DIRECT_RUN = /process\.argv\[1\]|isDirectScriptInvocation\(/;
const INSTALLS_HOOKS = /\binstallScraperFetchHooks\(/;
const INSTALLS_HOOKS_WITHOUT_VALIDATOR_CACHE =
  /\binstallScraperFetchHooks\(\{\s*validatorCache:\s*false\s*\}\)/;
const SCRIPT_CONNECT = /\binitializeConnections\((?!\s*mongoOptions\b)/;

/**
 * Fetch paths the axios hooks cannot see, and why each is still paced. Each reason names the
 * mechanism the next assertion checks, so an entry cannot outlive the pacing it relies on.
 */
const FETCH_PATHS_OUTSIDE_THE_HOOKS: Record<string, { reason: string; pacedBy: RegExp }> = {
  'src/scrapers/renderedFetch.ts': {
    reason:
      'the Scrapling bridge drives a headless browser in a Python child process, which no axios hook reaches; it takes its own host slot before each render',
    pacedBy: /acquireHostSlotWithin\(\s*scraperHostSlotLimiter\(\)/,
  },
};

/**
 * Scripts whose purpose is to learn whether a URL is live today without calling the link-health
 * probe. A body reused from the validator cache would make a page that has since died read alive.
 */
const LIVENESS_CHECKS_WITHOUT_THE_PROBE: Record<string, string> = {
  'src/scripts/betaDataQuality.ts': 'its live link check reports whether each served link answers',
  'src/scripts/clearDeadLabResearchHomes.ts': 'it clears a lab home whose page no longer answers',
  'src/scripts/findLabWebsites.ts': 'it adopts a candidate lab site only when the page answers',
  'src/scripts/hostThrottleProbe.ts': 'it measures how a host answers right now',
  'src/scripts/repairLegacyPersonPageUrls.ts':
    'it adopts a replacement person page only when the page answers',
};

const read = (relative: string): string =>
  fs.readFileSync(path.join(SERVER_ROOT, relative), 'utf8');

const listTypeScript = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listTypeScript(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

const packageScriptTargets = (): Set<string> => {
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const targets = Object.values(packageJson.scripts).flatMap((command) =>
    Array.from(command.matchAll(/\bsrc\/(?:scripts|scrapers)\/[\w/.-]+\.ts\b/g), (m) => m[0]),
  );
  return new Set(targets);
};

const isFetchingEntryPoint = (source: string, runByPackageScript: boolean): boolean =>
  FETCHING_IMPORT.test(source) && (runByPackageScript || DIRECT_RUN.test(source));

const reachesFetchHooks = (source: string): boolean =>
  INSTALLS_HOOKS.test(source) || SCRIPT_CONNECT.test(source);

const fetchingEntryPoints = (): string[] => {
  const packageTargets = packageScriptTargets();
  const candidates = [
    ...listTypeScript(SCRIPTS_DIR).map((file) => path.relative(SERVER_ROOT, file)),
  ];
  const fetching = candidates.filter((file) =>
    isFetchingEntryPoint(read(file), packageTargets.has(file)),
  );
  return Array.from(new Set([...fetching, ...LANE_RUNNING_ENTRY_POINTS])).sort();
};

describe('every fetching script entry point installs the scraper fetch hooks (#6193)', () => {
  const entryPoints = fetchingEntryPoints();

  it('finds the fetching entry points it was written for', () => {
    expect(entryPoints).toEqual(
      expect.arrayContaining([
        'src/scrapers/cli.ts',
        'src/scripts/scrapeCanary.ts',
        'src/scripts/auditDepartmentCatalogDrift.ts',
        'src/scripts/auditRosterLanes.ts',
        'src/scripts/backfillSourceLinkHealth.ts',
        'src/scripts/betaDataQuality.ts',
        'src/scripts/fraResearchSynthesisAbHarness.ts',
        'src/scripts/hostThrottleProbe.ts',
        'src/scripts/repairSupersededEntitySourceUrls.ts',
        'src/scripts/verifyOfficialProfileLinks.ts',
      ]),
    );
  });

  it('reaches installScraperFetchHooks directly or through initializeConnections', () => {
    expect(entryPoints.filter((file) => !reachesFetchHooks(read(file)))).toEqual([]);
  });

  it('installs them for any lane run, whichever process starts the orchestrator', () => {
    expect(read('src/scrapers/orchestrator.ts')).toMatch(INSTALLS_HOOKS);
  });

  it('flags a new fetching script that skips the install', () => {
    const skipping = [
      "import axios from 'axios';",
      'async function main() { await axios.get(process.argv[2]); }',
      'if (process.argv[1]) void main();',
    ].join('\n');

    expect(isFetchingEntryPoint(skipping, false)).toBe(true);
    expect(reachesFetchHooks(skipping)).toBe(false);
    expect(reachesFetchHooks(`${skipping}\nawait initializeConnections(mongoOptions);`)).toBe(
      false,
    );
  });

  it('turns the validator cache off in every script that checks whether a URL is live', () => {
    const livenessChecks = entryPoints.filter(
      (file) =>
        LINK_HEALTH_IMPORT.test(read(file)) ||
        Object.hasOwn(LIVENESS_CHECKS_WITHOUT_THE_PROBE, file),
    );

    expect(livenessChecks).toEqual(
      expect.arrayContaining([
        'src/scripts/backfillFellowshipSourceLinkHealth.ts',
        'src/scripts/backfillSourceLinkHealth.ts',
        'src/scripts/hostThrottleProbe.ts',
        'src/scripts/verifyOfficialProfileLinks.ts',
      ]),
    );
    expect(
      livenessChecks.filter((file) => !INSTALLS_HOOKS_WITHOUT_VALIDATOR_CACHE.test(read(file))),
    ).toEqual([]);
  });

  it('names only real fetching entry points, each with a reason, as liveness checks', () => {
    for (const [file, reason] of Object.entries(LIVENESS_CHECKS_WITHOUT_THE_PROBE)) {
      expect(reason.trim(), file).not.toBe('');
      expect(entryPoints, file).toContain(file);
    }
  });

  it('documents each fetch path outside the hooks and checks it still paces itself', () => {
    for (const [file, { reason, pacedBy }] of Object.entries(FETCH_PATHS_OUTSIDE_THE_HOOKS)) {
      expect(reason.trim(), file).not.toBe('');
      expect(read(file), file).toMatch(pacedBy);
    }
  });
});

describe('one honest User-Agent (#6211)', () => {
  const sources = [
    ...listTypeScript(path.join(SERVER_ROOT, 'src')).map((file) =>
      path.relative(SERVER_ROOT, file),
    ),
  ].filter((file) => !file.endsWith('scraperUserAgent.ts'));

  it('sets no User-Agent header to anything but SCRAPER_USER_AGENT', () => {
    const offenders = sources.flatMap((file) =>
      Array.from(read(file).matchAll(/['"]user-agent['"]\s*:\s*([^,}\n]+)/gi), (match) => ({
        file,
        value: match[1].trim(),
      })).filter(({ value }) => value !== 'SCRAPER_USER_AGENT'),
    );

    expect(offenders).toEqual([]);
  });

  it('presents itself as no browser and claims no Yale domain', () => {
    expect(
      sources.filter((file) =>
        /Mozilla\/5\.0|Chrome\/\d|YLabsBot|ylabs\.yale\.edu|YaleResearchRenderedFetch/.test(
          read(file),
        ),
      ),
    ).toEqual([]);
  });
});
