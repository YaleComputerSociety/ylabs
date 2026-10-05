import { describe, expect, it } from 'vitest';

import { GRANT_SOURCE_NAMES } from '../../scripts/grantCorpusSynthesisCore';
import { NON_ORGANIZATION_ASSERTING_LANES } from '../../scripts/researchEntityKindTypingAuditCore';
import { RESEARCH_SWEEP_SOURCES } from '../../scripts/runScraperSweep';

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
import { buildResearchEntityObservations as crossrefObservations } from '../sources/crossrefGrantScraper';
import { buildResearchEntityObservations as doeObservations } from '../sources/doeOstiGrantScraper';
import { buildResearchEntityObservations as nehObservations } from '../sources/nehGrantScraper';
import { piGrantsToObservations as nihObservations } from '../sources/nihReporterScraper';
import { buildResearchEntityObservations as nsfObservations } from '../sources/nsfAwardScraper';
import type { ObservationInput } from '../types';

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

const SYNTHETIC_ROW = 'synthetic-row';
const SYNTHETIC_RESEARCHER = 'synthetic-researcher';

const OBSERVATIONS_BY_LANE: Record<
  (typeof GRANT_LANE_SOURCE_NAMES)[number],
  () => ObservationInput[]
> = {
  'nih-reporter': () =>
    nihObservations(
      [
        {
          project_num: '5R01XX000001-01',
          core_project_num: 'R01XX000001',
          project_title: 'Synthetic project',
          project_start_date: '2025-01-01T00:00:00',
          project_end_date: '2029-12-31T00:00:00',
        },
      ],
      SYNTHETIC_RESEARCHER,
      SYNTHETIC_ROW,
    ),
  'nsf-award-search': () =>
    nsfObservations(
      {
        piFirstName: 'Synthetic',
        piLastName: 'Investigator',
        awards: [
          {
            id: '0000001',
            title: 'Synthetic award',
            startDate: '01/01/2025',
            expDate: '12/31/2029',
          },
        ],
      },
      SYNTHETIC_RESEARCHER,
      SYNTHETIC_ROW,
    ),
  'neh-funded-projects': () =>
    nehObservations(
      {
        piFirstName: 'Synthetic',
        piLastName: 'Investigator',
        fullName: 'Synthetic Investigator',
        awards: [
          {
            appNumber: 'XX-000001-25',
            institution: 'Yale University',
            instState: 'CT',
            projectTitle: 'Synthetic project',
            program: 'Synthetic program',
            division: 'Synthetic division',
            beginGrant: new Date('2025-01-01'),
            endGrant: new Date('2029-12-31'),
            projectDesc: '',
            primaryDiscipline: 'History',
            participants: [],
          },
        ],
      },
      SYNTHETIC_RESEARCHER,
      SYNTHETIC_ROW,
    ),
  'doe-osti': () =>
    doeObservations(
      {
        userId: SYNTHETIC_RESEARCHER,
        piName: 'Synthetic Investigator',
        records: [
          {
            osti_id: '0000001',
            title: 'Synthetic report',
            doe_contract_number: 'SC0000001',
            publication_date: '2025-01-01T00:00:00Z',
          },
        ],
      },
      SYNTHETIC_ROW,
    ),
  'crossref-grants': () =>
    crossrefObservations({
      slug: SYNTHETIC_ROW,
      researcherIds: new Set([SYNTHETIC_RESEARCHER]),
      grants: [
        {
          doi: '10.0000/synthetic',
          awardNumber: 'SYN-0001',
          funderName: 'Synthetic Foundation',
          title: 'Synthetic grant',
          description: '',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2029-12-31'),
          lead: { given: 'Synthetic', family: 'Investigator' },
          traineeAward: false,
        },
      ],
    }),
};

describe('grant lanes only enrich', () => {
  it('emits only enrichment fields from every grant lane', () => {
    for (const [lane, build] of Object.entries(OBSERVATIONS_BY_LANE)) {
      const fields = [...new Set(build().map((observation) => observation.field))].sort();
      expect({ lane, fields }).toEqual({ lane, fields: [...GRANT_LANE_ENRICHMENT_FIELDS].sort() });
    }
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
