import { describe, expect, it } from 'vitest';
import {
  INVENTORY_COLLECTIONS,
  REFERENCE_EDGES,
  RETIREMENT_FIELD_PROBES,
  buildResearchModelInventoryOutput,
  buildResearchModelInventoryReport,
  findUnclassifiedCollections,
  parseResearchModelInventoryArgs,
  type InventoryFacts,
} from '../researchModelInventoryCore';

function emptyFacts(): InventoryFacts {
  return {
    liveCollections: [],
    census: [],
    fieldPresence: [],
    referenceIntegrity: [],
  };
}

describe('INVENTORY_COLLECTIONS', () => {
  it('has unique physical collection names', () => {
    const names = INVENTORY_COLLECTIONS.map((spec) => spec.collection);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks every scholarly collection for phase 3 retirement', () => {
    const scholarly = INVENTORY_COLLECTIONS.filter((spec) => spec.group === 'scholarly-retire');
    expect(scholarly.length).toBeGreaterThan(0);
    for (const spec of scholarly) {
      expect(spec.phase).toBe(3);
    }
  });

  it('flags the hard-pivot collections as expected-gone residue', () => {
    const residue = INVENTORY_COLLECTIONS.filter((spec) => spec.expectPresent === false);
    expect(residue.map((spec) => spec.collection)).toContain('research_groups');
    expect(residue.map((spec) => spec.collection)).toContain('applications');
  });
});

describe('findUnclassifiedCollections', () => {
  it('returns live collections not in the spec, excluding system collections', () => {
    const live = ['research_entities', 'system.indexes', 'mystery_collection', '__prewarm'];
    expect(findUnclassifiedCollections(live)).toEqual(['mystery_collection']);
  });

  it('returns empty when all live collections are classified', () => {
    const live = INVENTORY_COLLECTIONS.map((spec) => spec.collection);
    expect(findUnclassifiedCollections(live)).toEqual([]);
  });
});

describe('buildResearchModelInventoryReport', () => {
  it('marks a spec collection absent when it is not live', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    const entities = report.collections.find((row) => row.collection === 'research_entities');
    expect(entities?.present).toBe(false);
    expect(entities?.documentCount).toBe(0);
    expect(report.summary.collectionsPresent).toBe(0);
    expect(report.summary.totalDocuments).toBe(0);
  });

  it('reports legacy residue only when an expected-gone collection holds documents', () => {
    const withResidue = buildResearchModelInventoryReport({
      ...emptyFacts(),
      liveCollections: ['research_groups', 'applications'],
      census: [
        { collection: 'research_groups', present: true, documentCount: 12, schemaVersions: [] },
        { collection: 'applications', present: true, documentCount: 0, schemaVersions: [] },
      ],
    });
    // research_groups has documents -> residue; applications is empty -> not residue.
    expect(withResidue.summary.legacyResidueCollections).toEqual(['research_groups']);
    const appsRow = withResidue.collections.find((row) => row.collection === 'applications');
    expect(appsRow?.residue).toBe(false);
  });

  it('computes retirement-field prevalence and counts fields still present', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      liveCollections: ['research_entities'],
      fieldPresence: [
        { collection: 'research_entities', field: 'acceptingUndergrads', present: 40, total: 200 },
        { collection: 'research_entities', field: 'kind', present: 0, total: 200 },
      ],
    });
    const accepting = report.retirementFields.find((row) => row.field === 'acceptingUndergrads');
    expect(accepting?.prevalence).toBe(0.2);
    // Only fields with present > 0 count toward "still present".
    expect(report.summary.retirementFieldsStillPresent).toBe(1);
  });

  it('flags reference edges with orphans and keeps clean edges clean', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      liveCollections: ['research_entity_members', 'research_entities', 'users'],
      referenceIntegrity: [
        {
          name: 'member_to_entity',
          fromCollection: 'research_entity_members',
          toCollection: 'research_entities',
          checked: 100,
          orphaned: 5,
          sampleOrphanIds: ['a', 'b'],
        },
        {
          name: 'member_to_user',
          fromCollection: 'research_entity_members',
          toCollection: 'users',
          checked: 100,
          orphaned: 0,
          sampleOrphanIds: [],
        },
      ],
    });
    const memberToEntity = report.referenceIntegrity.find((row) => row.name === 'member_to_entity');
    expect(memberToEntity?.clean).toBe(false);
    expect(memberToEntity?.orphanRate).toBe(0.05);
    const memberToUser = report.referenceIntegrity.find((row) => row.name === 'member_to_user');
    expect(memberToUser?.clean).toBe(true);
    expect(report.summary.referenceEdgesWithOrphans).toBe(1);
    expect(report.summary.totalOrphans).toBe(5);
  });

  it('covers every declared reference edge in the report even with no facts', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    expect(report.referenceIntegrity).toHaveLength(REFERENCE_EDGES.length);
    expect(report.retirementFields).toHaveLength(RETIREMENT_FIELD_PROBES.length);
    expect(report.summary.referenceEdgesChecked).toBe(REFERENCE_EDGES.length);
  });

  it('surfaces unclassified live collections in the summary', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      liveCollections: ['research_entities', 'surprise_collection'],
    });
    expect(report.summary.unclassifiedCollections).toEqual(['surprise_collection']);
  });
});

describe('parseResearchModelInventoryArgs', () => {
  it('defaults the sample limit and leaves output undefined', () => {
    const args = parseResearchModelInventoryArgs([]);
    expect(args.sampleLimit).toBe(20);
    expect(args.output).toBeUndefined();
  });

  it('parses sample limit and output path', () => {
    const args = parseResearchModelInventoryArgs(['--sample-limit', '5', '--output', '/tmp/x.json']);
    expect(args.sampleLimit).toBe(5);
    expect(args.output).toBe('/tmp/x.json');
  });

  it('rejects a negative sample limit', () => {
    expect(() => parseResearchModelInventoryArgs(['--sample-limit', '-1'])).toThrow();
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchModelInventoryArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});

describe('buildResearchModelInventoryOutput', () => {
  it('wraps the report with metadata and a stable generatedAt', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    const output = buildResearchModelInventoryOutput(report, {
      environment: 'beta',
      db: 'ylabs-beta',
      generatedAt: '2026-07-24T00:00:00.000Z',
      options: { sampleLimit: 20 },
    });
    expect(output.generatedAt).toBe('2026-07-24T00:00:00.000Z');
    expect(output.environment).toBe('beta');
    expect(output.db).toBe('ylabs-beta');
    expect(output.options.sampleLimit).toBe(20);
    expect(output.summary.collectionsClassified).toBe(INVENTORY_COLLECTIONS.length);
  });

  it('omits environment and db when not provided', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    const output = buildResearchModelInventoryOutput(report, { options: { sampleLimit: 20 } });
    expect('environment' in output).toBe(false);
    expect('db' in output).toBe(false);
    expect(typeof output.generatedAt).toBe('string');
  });
});
