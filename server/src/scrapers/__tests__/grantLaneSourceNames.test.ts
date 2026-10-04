import { describe, expect, it } from 'vitest';

import { GRANT_SOURCE_NAMES } from '../../scripts/grantCorpusSynthesisCore';
import { NON_ORGANIZATION_ASSERTING_LANES } from '../../scripts/researchEntityKindTypingAuditCore';
import { RESEARCH_SWEEP_SOURCES } from '../../scripts/runScraperSweep';
import { GRANT_LANE_SOURCE_NAMES } from '../grantLaneSourceNames';
import { buildOrchestrator } from '../registry';

const registeredNames = new Set(
  buildOrchestrator()
    .list()
    .map((scraper) => scraper.name),
);

const unregistered = (names: Iterable<string>): string[] =>
  [...names].filter((name) => !registeredNames.has(name));

describe('grant-lane source names', () => {
  it('names only registered scrapers', () => {
    expect(unregistered(GRANT_LANE_SOURCE_NAMES)).toEqual([]);
  });

  it('is exactly the funding phase of the research sweep', () => {
    const fundingPhase = RESEARCH_SWEEP_SOURCES.filter((source) => source.phase === 'funding').map(
      (source) => source.name,
    );
    expect([...GRANT_LANE_SOURCE_NAMES].sort()).toEqual([...fundingPhase].sort());
  });

  it('is the list the kind-typing audit treats as non-organization-asserting', () => {
    expect([...NON_ORGANIZATION_ASSERTING_LANES]).toEqual([...GRANT_LANE_SOURCE_NAMES]);
  });

  it('leaves no grant-source list elsewhere naming an unregistered scraper', () => {
    expect(unregistered(GRANT_SOURCE_NAMES)).toEqual([]);
  });
});
