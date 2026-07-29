import fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  BETA_ROLLOUT_ORDER,
  EXPECTED_SOURCE_NAMES,
  GATED_SOURCES,
} from '../../scripts/betaReadinessGate';
import { buildOrchestrator } from '../registry';

const renderBlueprint = fs.readFileSync(
  new URL('../../../../render.yaml', import.meta.url),
  'utf8',
);
const serverPackage = JSON.parse(
  fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as {
  scripts?: Record<string, string>;
};
const scraperCli = fs.readFileSync(new URL('../cli.ts', import.meta.url), 'utf8');
const departmentRosterScraper = fs.readFileSync(
  new URL('../sources/departmentRosterScraper.ts', import.meta.url),
  'utf8',
);
const entityMaterializer = fs.readFileSync(
  new URL('../entityMaterializer.ts', import.meta.url),
  'utf8',
);

const RETIRED_BIBLIOGRAPHIC_SOURCES = [
  'arxiv',
  'openalex',
  'orcid',
  'europe-pmc',
  'pubmed',
  'crossref',
] as const;

function registeredSourceNames(): Set<string> {
  return new Set(
    buildOrchestrator()
      .list()
      .map(({ name }) => name),
  );
}

function renderScheduledSourceNames(): string[] {
  const commands = Array.from(
    renderBlueprint.matchAll(/^\s*startCommand:\s*>-\s*$((?:\n {6,}\S.*)*)/gm),
    (match) => match[1].replace(/\s+/g, ' '),
  ).flatMap((commandBlock) => commandBlock.split(';'));

  return commands
    .filter((command) => /\bscrape\s+cron\b/.test(command))
    .map((command) => {
      const source = command.match(/(?:^|\s)--source(?:\s+|=)([a-z0-9-]+)(?=\s|$)/)?.[1];
      if (!source) {
        throw new Error(
          `Render scrape cron command is missing a valid --source: ${command.trim()}`,
        );
      }
      return source;
    });
}

describe('deployed scraper source contract', () => {
  it('schedules only scraper sources registered by the orchestrator', () => {
    const registered = registeredSourceNames();
    const scheduled = renderScheduledSourceNames();

    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.filter((sourceName) => !registered.has(sourceName))).toEqual([]);
  });

  it('requires and rolls out only scraper sources registered by the orchestrator', () => {
    const registered = registeredSourceNames();
    const readinessSources = [...EXPECTED_SOURCE_NAMES, ...BETA_ROLLOUT_ORDER, ...GATED_SOURCES];

    expect(readinessSources.filter((sourceName) => !registered.has(sourceName))).toEqual([]);
  });

  it('keeps retired bibliography out of deployment and supported operator commands', () => {
    const scheduled = new Set(renderScheduledSourceNames());
    const readinessSources = new Set<string>([
      ...EXPECTED_SOURCE_NAMES,
      ...BETA_ROLLOUT_ORDER,
      ...GATED_SOURCES,
    ]);

    for (const sourceName of RETIRED_BIBLIOGRAPHIC_SOURCES) {
      expect(scheduled.has(sourceName)).toBe(false);
      expect(readinessSources.has(sourceName)).toBe(false);
    }
    expect(serverPackage.scripts?.['papers:authorship-audit']).toBeUndefined();
    expect(
      serverPackage.scripts?.['scholarly-links:repair-official-profile-pointers'],
    ).toBeUndefined();
    expect(scraperCli).not.toMatch(/--discover-openalex-authors|--max-openalex-pages-per-author/);
    expect(scraperCli).not.toMatch(/--source openalex/);
  });

  it('keeps the department roster and user materializer out of scholarly ingestion', () => {
    expect(departmentRosterScraper).not.toContain('officialProfilePublications');
    expect(departmentRosterScraper).not.toContain('publicationListUrls');
    expect(entityMaterializer).not.toContain("from '../models/researchScholarlyLink'");
    expect(entityMaterializer).not.toContain('materializeOfficialProfileScholarlyLinks');
  });
});
