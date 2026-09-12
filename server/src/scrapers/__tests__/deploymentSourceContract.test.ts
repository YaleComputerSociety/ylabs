import fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  BETA_ROLLOUT_ORDER,
  EXPECTED_SOURCE_NAMES,
  GATED_SOURCES,
} from '../../scripts/betaReadinessGate';
import { FELLOWSHIP_SWEEP_SOURCES, RESEARCH_SWEEP_SOURCES } from '../../scripts/runScraperSweep';
import { buildOrchestrator } from '../registry';
import { RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES } from '../retiredPaperPipeline';

const serverPackage = JSON.parse(
  fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as {
  scripts?: Record<string, string>;
};
const serverEnvExample = fs.readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
const scraperCli = fs.readFileSync(new URL('../cli.ts', import.meta.url), 'utf8');
const scraperCliHelpers = fs.readFileSync(new URL('../cliHelpers.ts', import.meta.url), 'utf8');
const departmentRosterScraper = fs.readFileSync(
  new URL('../sources/departmentRosterScraper.ts', import.meta.url),
  'utf8',
);
const entityMaterializer = fs.readFileSync(
  new URL('../entityMaterializer.ts', import.meta.url),
  'utf8',
);
const retiredPaperPipeline = fs.readFileSync(
  new URL('../retiredPaperPipeline.ts', import.meta.url),
  'utf8',
);

const RETIRED_SCRAPER_MODULES = [
  'arxivPreprintScraper.ts',
  'crossrefPaperScraper.ts',
  'europePmcPaperScraper.ts',
  'openAlexPaperScraper.ts',
  'orcidWorksScraper.ts',
] as const;

function registeredSourceNames(): Set<string> {
  return new Set(
    buildOrchestrator()
      .list()
      .map(({ name }) => name),
  );
}

// Development is the only environment that scrapes; Beta and Production receive
// whole-collection copies. So the list that decides what actually runs is the
// sweep's own source registry, not a deployment blueprint.
function sweptSourceNames(): string[] {
  return [...RESEARCH_SWEEP_SOURCES, ...FELLOWSHIP_SWEEP_SOURCES].map((source) => source.name);
}

describe('deployed scraper source contract', () => {
  it('sweeps only scraper sources registered by the orchestrator', () => {
    const registered = registeredSourceNames();
    const swept = sweptSourceNames();

    expect(swept.length).toBeGreaterThan(0);
    expect(swept.filter((sourceName) => !registered.has(sourceName))).toEqual([]);
  });

  // render.yaml declared Production scraper crons that could not affect the data:
  // Production is a copy of Beta, which is a copy of Development, and
  // copyCollection deletes the target before inserting, so anything a Production
  // cron wrote was replaced by the next promotion. Its `scrape_runs` history was
  // mirrored too, which is why a cron that never fired looked successful (#2513).
  // Pinned so a blueprint is not re-added without deciding it should exist.
  it('declares no deployment blueprint, since no deployed environment scrapes', () => {
    expect(fs.existsSync(new URL('../../../../render.yaml', import.meta.url))).toBe(false);
  });

  it('requires and rolls out only scraper sources registered by the orchestrator', () => {
    const registered = registeredSourceNames();
    const readinessSources = [...EXPECTED_SOURCE_NAMES, ...BETA_ROLLOUT_ORDER, ...GATED_SOURCES];

    expect(readinessSources.filter((sourceName) => !registered.has(sourceName))).toEqual([]);
  });

  it('keeps retired bibliography out of deployment and supported operator commands', () => {
    const swept = new Set(sweptSourceNames());
    const readinessSources = new Set<string>([
      ...EXPECTED_SOURCE_NAMES,
      ...BETA_ROLLOUT_ORDER,
      ...GATED_SOURCES,
    ]);

    for (const sourceName of RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES) {
      expect(swept.has(sourceName)).toBe(false);
      expect(readinessSources.has(sourceName)).toBe(false);
    }
    for (const moduleName of RETIRED_SCRAPER_MODULES) {
      expect(fs.existsSync(new URL(`../sources/${moduleName}`, import.meta.url)), moduleName).toBe(
        false,
      );
    }
    expect(serverPackage.scripts?.['papers:authorship-audit']).toBeUndefined();
    expect(
      serverPackage.scripts?.['scholarly-links:repair-official-profile-pointers'],
    ).toBeUndefined();
    expect(scraperCli).not.toMatch(/--discover-openalex-authors|--max-openalex-pages-per-author/);
    expect(scraperCliHelpers).not.toMatch(
      /discoverOpenAlexAuthors|maxOpenAlexPagesPerAuthor|discover-openalex-authors|max-openalex-pages-per-author/,
    );
    expect(scraperCli).not.toMatch(/--source openalex/);
  });

  it('keeps the department roster and user materializer out of scholarly ingestion', () => {
    expect(departmentRosterScraper).not.toContain('officialProfilePublications');
    expect(departmentRosterScraper).not.toContain('publicationListUrls');
    expect(entityMaterializer).not.toContain("from '../models/researchScholarlyLink'");
    expect(entityMaterializer).not.toContain('materializeOfficialProfileScholarlyLinks');
  });

  it('retires paper materialization with no rollback opt-in anywhere', () => {
    const flag = 'RETIRED_PAPER_PIPELINE_ROLLBACK';
    const packageCommands = Object.values(serverPackage.scripts || {}).join('\n');

    expect(retiredPaperPipeline).not.toContain('RETIRED_PAPER_PIPELINE_ROLLBACK');
    expect(entityMaterializer).not.toContain('isRetiredPaperPipelineRollbackEnabled');
    expect(entityMaterializer).not.toContain("from '../models/paper'");
    expect(entityMaterializer).not.toContain("from '../models/paperAuthor'");
    expect(serverEnvExample).not.toContain(flag);
    expect(packageCommands).not.toContain(flag);
  });
});
