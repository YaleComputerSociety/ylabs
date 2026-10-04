import { describe, expect, it } from 'vitest';

import { GRANT_SOURCE_NAMES } from '../../scripts/grantCorpusSynthesisCore';
import { NON_ORGANIZATION_ASSERTING_LANES } from '../../scripts/researchEntityKindTypingAuditCore';
import { RESEARCH_SWEEP_SOURCES } from '../../scripts/runScraperSweep';
import fs from 'fs';
import path from 'path';

import {
  MATERIALIZER_MANAGED_FIELDS,
  shouldIgnoreObservationForEntityMaterialization,
} from '../entityMaterializer';
import {
  GRANT_LANE_ENRICHMENT_FIELDS,
  GRANT_LANE_SOURCE_NAMES,
  isGrantLaneObservationOutsideEnrichment,
} from '../grantLaneSourceNames';
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

  it('is the list grant corpus synthesis reads its evidence from', () => {
    expect([...GRANT_SOURCE_NAMES].sort()).toEqual([...GRANT_LANE_SOURCE_NAMES].sort());
  });
});

const GRANT_LANE_SOURCE_FILES = [
  'nihReporterScraper.ts',
  'nsfAwardScraper.ts',
  'nehGrantScraper.ts',
  'doeOstiGrantScraper.ts',
  'crossrefGrantScraper.ts',
];

describe('grant lanes only enrich', () => {
  it('emits only enrichment fields from every grant lane', () => {
    const emitted = new Set(
      GRANT_LANE_SOURCE_FILES.flatMap((file) =>
        [
          ...fs
            .readFileSync(path.resolve(__dirname, '../sources', file), 'utf8')
            .matchAll(/field: '([A-Za-z]+)'/g),
        ].map((match) => match[1]),
      ),
    );
    expect([...emitted].sort()).toEqual([...GRANT_LANE_ENRICHMENT_FIELDS].sort());
    expect(GRANT_LANE_SOURCE_FILES).toHaveLength(GRANT_LANE_SOURCE_NAMES.length);
  });

  it('ignores a grant-lane identity observation at materialize', () => {
    for (const sourceName of GRANT_LANE_SOURCE_NAMES) {
      for (const field of ['name', 'displayName', 'entityType', 'slug', 'sourceUrls']) {
        expect(isGrantLaneObservationOutsideEnrichment({ sourceName, field })).toBe(true);
        expect(
          shouldIgnoreObservationForEntityMaterialization('researchEntity', {
            sourceName,
            field,
            value: 'x',
          }),
        ).toBe(true);
      }
    }
  });

  it('keeps every grant enrichment field and other lanes identity fields', () => {
    for (const field of GRANT_LANE_ENRICHMENT_FIELDS) {
      if (MATERIALIZER_MANAGED_FIELDS.has(field)) continue;
      expect(
        shouldIgnoreObservationForEntityMaterialization('researchEntity', {
          sourceName: 'nsf-award-search',
          field,
          value: 1,
        }),
      ).toBe(false);
    }
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        sourceName: 'lab-microsite-description-llm',
        field: 'name',
        value: 'x',
      }),
    ).toBe(false);
  });
});
