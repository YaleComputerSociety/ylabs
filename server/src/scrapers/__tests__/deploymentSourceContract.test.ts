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
  return Array.from(
    renderBlueprint.matchAll(/scrape cron --source ([a-z0-9-]+) --release/g),
    (match) => match[1],
  );
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
  });
});
