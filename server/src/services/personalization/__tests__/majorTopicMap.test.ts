import { describe, expect, it } from 'vitest';
import {
  hasPersonalizationSignal,
  MAJOR_TOPIC_MAP,
  normalizeMajorName,
  resolveMajorTopicMapping,
  YALIES_ABBREVIATED_MAJOR_NAMES,
} from '../majorTopicMap';
import { buildServedFacetSnapshot } from '../servedFacetSnapshot';
import snapshot from '../servedFacetValues.snapshot.json';
import yaliesMajorStrings from './fixtures/yaliesMajorStrings.json';
import catalogMajors from './fixtures/yaleCollegeCatalogMajors.json';
import precisionLabels from './fixtures/majorTopicPrecisionLabels.json';

const MAX_RESEARCH_AREAS_PER_MAJOR = 40;
const MIN_MAPPED_RESEARCH_AREA_ROWS = 5;
const MIN_SAMPLED_PRECISION = 0.8;
const SAMPLE_SIZE = 15;

const mappings = Object.entries(MAJOR_TOPIC_MAP);

describe('MAJOR_TOPIC_MAP', () => {
  it('maps only research areas the served snapshot holds with enough rows to survive corpus churn', () => {
    const tooRare = mappings.flatMap(([major, mapping]) =>
      mapping.researchAreas
        .filter(
          (area) =>
            ((snapshot.researchAreas as Record<string, number>)[area] ?? 0) <
            MIN_MAPPED_RESEARCH_AREA_ROWS,
        )
        .map((area) => `${major}: ${area}`),
    );
    expect(tooRare).toEqual([]);
  });

  it('maps only departments the served snapshot holds', () => {
    const unknown = mappings.flatMap(([major, mapping]) =>
      mapping.departments
        .filter((department) => !(department in snapshot.departments))
        .map((department) => `${major}: ${department}`),
    );
    expect(unknown).toEqual([]);
  });

  it(`keeps every major at or under ${MAX_RESEARCH_AREAS_PER_MAJOR} research areas`, () => {
    const oversized = mappings
      .filter(([, mapping]) => mapping.researchAreas.length > MAX_RESEARCH_AREAS_PER_MAJOR)
      .map(([major]) => major);
    expect(oversized).toEqual([]);
  });

  it('gives a reason exactly when a major carries no personalization signal', () => {
    for (const [major, mapping] of mappings) {
      const hasSignal = hasPersonalizationSignal(mapping);
      expect({ major, hasReason: Boolean(mapping.noSignalReason) }).toEqual({
        major,
        hasReason: !hasSignal,
      });
    }
  });

  it('lists no duplicate values within a major', () => {
    for (const [major, mapping] of mappings) {
      expect({ major, areas: new Set(mapping.researchAreas).size }).toEqual({
        major,
        areas: mapping.researchAreas.length,
      });
      expect({ major, departments: new Set(mapping.departments).size }).toEqual({
        major,
        departments: mapping.departments.length,
      });
    }
  });
});

describe('resolveMajorTopicMapping', () => {
  it('resolves every major string Yalies publishes', () => {
    const unresolved = yaliesMajorStrings.filter((major) => !resolveMajorTopicMapping(major));
    expect(unresolved).toEqual([]);
  });

  it('resolves every abbreviated Yalies major name', () => {
    const unresolved = Object.keys(YALIES_ABBREVIATED_MAJOR_NAMES).filter(
      (major) => !resolveMajorTopicMapping(major),
    );
    expect(unresolved).toEqual([]);
  });

  it('resolves every major in the Yale College catalog', () => {
    const unresolved = catalogMajors.filter((major) => !resolveMajorTopicMapping(major));
    expect(unresolved).toEqual([]);
  });

  it('treats the intensive track as its base major', () => {
    expect(resolveMajorTopicMapping('Physics (Int.)')).toBe(MAJOR_TOPIC_MAP.Physics);
  });

  it('matches across ampersand, comma and apostrophe spellings', () => {
    expect(resolveMajorTopicMapping('Ethics, Politics, and Economics')).toBe(
      MAJOR_TOPIC_MAP['Ethics, Politics, & Economics'],
    );
    expect(resolveMajorTopicMapping('Women’s, Gender, and Sexuality Studies')).toBe(
      MAJOR_TOPIC_MAP["Women's, Gender, & Sexuality Studies"],
    );
    expect(normalizeMajorName('  Greek, Ancient & Modern ')).toBe(
      normalizeMajorName('Greek, Ancient and Modern'),
    );
  });

  it('returns no mapping for a missing or unknown major', () => {
    expect(resolveMajorTopicMapping(undefined)).toBeNull();
    expect(resolveMajorTopicMapping('   ')).toBeNull();
    expect(resolveMajorTopicMapping('Not A Yale Major')).toBeNull();
  });

  it('carries no personalization signal for undeclared and visiting students', () => {
    expect(hasPersonalizationSignal(resolveMajorTopicMapping('Undeclared'))).toBe(false);
    expect(
      hasPersonalizationSignal(resolveMajorTopicMapping('Visiting International Program')),
    ).toBe(false);
  });
});

describe('major topic precision sample', () => {
  const labels = precisionLabels.labels as Record<string, Array<{ id: string; onTopic: boolean }>>;

  it('labels sampled majors that exist in the map with row ids only', () => {
    for (const [major, rows] of Object.entries(labels)) {
      expect(MAJOR_TOPIC_MAP[major]).toBeDefined();
      expect(rows).toHaveLength(SAMPLE_SIZE);
      for (const row of rows) expect(row.id).toMatch(/^[0-9a-f]{24}$/);
    }
  });

  it(`records at least ${MIN_SAMPLED_PRECISION} precision for every sampled major`, () => {
    const belowBar = Object.entries(labels)
      .map(([major, rows]) => ({
        major,
        precision: rows.filter((row) => row.onTopic).length / rows.length,
      }))
      .filter(({ precision }) => precision < MIN_SAMPLED_PRECISION);
    expect(belowBar).toEqual([]);
  });
});

describe('buildServedFacetSnapshot', () => {
  it('counts each row once per value and drops rare research areas', () => {
    const built = buildServedFacetSnapshot(
      [
        { researchAreas: ['Ecology', 'Ecology', 'Zoology'], departments: ['Biology'] },
        { researchAreas: ['Ecology'], departments: ['Biology', 'Physics'] },
        { researchAreas: 'not a list', departments: null },
      ],
      '2026-10-04',
      2,
    );
    expect(built).toEqual({
      capturedOn: '2026-10-04',
      servedRowCount: 3,
      minResearchAreaRows: 2,
      researchAreas: { Ecology: 2 },
      departments: { Biology: 2, Physics: 1 },
    });
  });
});
