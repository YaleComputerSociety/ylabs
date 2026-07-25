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

  it('classifies retained private student applications', () => {
    expect(
      INVENTORY_COLLECTIONS.find((spec) => spec.collection === 'student_applications'),
    ).toMatchObject({
      group: 'private',
      phase: 4,
      target: 'Private student application records (retained, normalized references)',
    });
  });
});

describe('inventory coverage', () => {
  it('has unique reference edge names', () => {
    const names = REFERENCE_EDGES.map((edge) => edge.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes current canonical and dual-truth reference edges', () => {
    expect(REFERENCE_EDGES.map((edge) => `${edge.fromCollection}.${edge.localField}`)).toEqual(
      expect.arrayContaining([
        'research_entity_members.facultyMemberId',
        'users.facultyMemberId',
        'users.studentProfileId',
        'faculty_members.userId',
        'student_profiles.userId',
        'access_signals.entryPathwayId',
        'access_signals.sourceEvidenceId',
        'access_signals.observationId',
        'contact_routes.entryPathwayId',
        'contact_routes.personId',
        'contact_routes.sourceEvidenceId',
        'posted_opportunities.researchEntityId',
        'posted_opportunities.listingId',
        'listings.researchEntityId',
        'observations.sourceId',
      ]),
    );
  });

  it('includes current private-record reference edges', () => {
    expect(REFERENCE_EDGES.map((edge) => `${edge.fromCollection}.${edge.localField}`)).toEqual(
      expect.arrayContaining([
        'student_applications.listingObjectId',
        'student_applications.postedOpportunityId',
        'student_applications.researchEntityId',
        'student_applications.studentUserId',
        'student_applications.studentProfileId',
        'student_trackings.studentProfileId',
        'student_trackings.researchEntityId',
        'student_outreaches.studentProfileId',
        'student_outreaches.researchEntityId',
        'student_outreaches.trackingId',
        'student_engagement_events.studentProfileId',
        'student_engagement_events.researchEntityId',
      ]),
    );
  });

  it('records current schema requiredness for every reference edge', () => {
    expect(REFERENCE_EDGES.every((edge) => typeof edge.required === 'boolean')).toBe(true);
    expect(REFERENCE_EDGES.find((edge) => edge.name === 'entry_pathway_to_entity')).toMatchObject({
      required: true,
    });
    expect(REFERENCE_EDGES.find((edge) => edge.name === 'member_to_entity')).toMatchObject({
      required: false,
    });
  });

  it('includes current compatibility and professor-mirror retirement fields', () => {
    expect(RETIREMENT_FIELD_PROBES.map((probe) => `${probe.collection}.${probe.field}`)).toEqual(
      expect.arrayContaining([
        'listings.researchGroupId',
        'student_trackings.researchGroupId',
        'student_outreaches.researchGroupId',
        'student_engagement_events.researchGroupId',
        'users.hIndex',
        'users.googleScholarId',
        'users.openAlexId',
        'users.semanticScholarId',
        'users.facultyMemberId',
        'users.googleScholarMetricsUpdatedAt',
        'users.openAlexWorksSyncedAt',
        'users.orcidWorksSyncedAt',
        'users.europePmcWorksSyncedAt',
        'users.pubmedWorksSyncedAt',
        'faculty_members.googleScholarId',
        'faculty_members.openAlexId',
        'faculty_members.semanticScholarId',
        'research_entities.opennessSignals',
        'research_entities.opennessStatusCache',
        'research_entities.opennessExplanationCache',
        'research_entities.opennessComputedAt',
        'research_entities.opennessLastSignalAt',
        'research_entities.recentPaperCount',
        'research_entities.lastPaperAtCache',
        'research_entities.activePaperCount2yCache',
        'research_entities.featuredPaperIds',
      ]),
    );
  });
});

describe('findUnclassifiedCollections', () => {
  it('returns live collections not in the spec, excluding system collections', () => {
    const live = ['research_entities', 'system.indexes', 'mystery_collection', '__prewarm'];
    expect(findUnclassifiedCollections(live)).toEqual(['__prewarm', 'mystery_collection']);
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
          status: 'checked',
          checked: 100,
          orphaned: 5,
          sampleOrphanIds: ['a', 'b'],
        },
        {
          name: 'member_to_user',
          fromCollection: 'research_entity_members',
          toCollection: 'users',
          status: 'checked',
          checked: 100,
          orphaned: 0,
          sampleOrphanIds: [],
        },
      ],
    });
    const memberToEntity = report.referenceIntegrity.find((row) => row.name === 'member_to_entity');
    expect(memberToEntity?.clean).toBe(false);
    expect(memberToEntity?.orphanRate).toBe(0.05);
    expect(memberToEntity?.localField).toBe('researchEntityId');
    expect(memberToEntity?.required).toBe(false);
    const memberToUser = report.referenceIntegrity.find((row) => row.name === 'member_to_user');
    expect(memberToUser?.clean).toBe(true);
    expect(report.summary.referenceEdgesWithOrphans).toBe(1);
    expect(report.summary.totalOrphans).toBe(5);
  });

  it('covers every declared reference edge in the report even with no facts', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    expect(report.referenceIntegrity).toHaveLength(REFERENCE_EDGES.length);
    expect(report.retirementFields).toHaveLength(RETIREMENT_FIELD_PROBES.length);
    expect(report.referenceIntegrity.every((row) => row.status === 'not-gathered')).toBe(true);
    expect(report.referenceIntegrity.every((row) => row.clean === null)).toBe(true);
    expect(report.summary.referenceEdgesChecked).toBe(0);
    expect(report.summary.referenceEdgesSkipped).toBe(REFERENCE_EDGES.length);
  });

  it('marks a missing source collection as skipped and indeterminate', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      referenceIntegrity: [
        {
          name: 'member_to_entity',
          fromCollection: 'research_entity_members',
          toCollection: 'research_entities',
          status: 'source-missing',
          checked: 0,
          orphaned: 0,
          sampleOrphanIds: [],
        },
      ],
    });
    const edge = report.referenceIntegrity.find((row) => row.name === 'member_to_entity');
    expect(edge).toMatchObject({
      status: 'source-missing',
      clean: null,
      checked: 0,
      orphaned: 0,
    });
    expect(report.summary.referenceEdgesChecked).toBe(0);
    expect(report.summary.referenceEdgesSkipped).toBe(REFERENCE_EDGES.length);
  });

  it('reports references to a missing target as checked orphans', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      referenceIntegrity: [
        {
          name: 'member_to_entity',
          fromCollection: 'research_entity_members',
          toCollection: 'research_entities',
          status: 'target-missing',
          checked: 3,
          orphaned: 3,
          sampleOrphanIds: ['member-1'],
        },
      ],
    });
    const edge = report.referenceIntegrity.find((row) => row.name === 'member_to_entity');
    expect(edge).toMatchObject({
      status: 'target-missing',
      clean: false,
      checked: 3,
      orphaned: 3,
    });
    expect(report.summary.referenceEdgesChecked).toBe(1);
    expect(report.summary.referenceEdgesWithOrphans).toBe(1);
    expect(report.summary.totalOrphans).toBe(3);
  });

  it('keeps a missing unused target explicit without creating a blocker', () => {
    const report = buildResearchModelInventoryReport({
      ...emptyFacts(),
      referenceIntegrity: [
        {
          name: 'student_application_to_listing',
          fromCollection: 'student_applications',
          toCollection: 'listings',
          status: 'target-missing',
          checked: 0,
          orphaned: 0,
          sampleOrphanIds: [],
        },
      ],
    });
    const edge = report.referenceIntegrity.find(
      (row) => row.name === 'student_application_to_listing',
    );
    expect(edge).toMatchObject({
      status: 'target-missing',
      clean: null,
      checked: 0,
      orphaned: 0,
    });
    expect(report.summary.referenceEdgesChecked).toBe(1);
    expect(report.summary.referenceEdgesWithOrphans).toBe(0);
  });

  it('states that orphan and field coverage is curated', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    expect(report.summary.coverageScope).toContain('Curated refactor-relevant');
    expect(report.summary.coverageScope).toContain('only tracked edges');
    expect(report.summary.coverageScope).toContain('not an exhaustive');
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
  it('requires an explicit environment and defaults other options', () => {
    const args = parseResearchModelInventoryArgs(['--environment', 'beta']);
    expect(args.environment).toBe('beta');
    expect(args.sampleLimit).toBe(20);
    expect(args.output).toBeUndefined();
  });

  it('parses sample limit and output path', () => {
    const args = parseResearchModelInventoryArgs([
      '--environment',
      'production-copy',
      '--sample-limit',
      '5',
      '--output',
      '/tmp/x.json',
    ]);
    expect(args.environment).toBe('production-copy');
    expect(args.sampleLimit).toBe(5);
    expect(args.output).toBe('/tmp/x.json');
  });

  it('rejects a negative sample limit', () => {
    expect(() =>
      parseResearchModelInventoryArgs(['--environment', 'beta', '--sample-limit', '-1']),
    ).toThrow();
  });

  it('rejects missing and invalid environments', () => {
    expect(() => parseResearchModelInventoryArgs([])).toThrow('--environment is required');
    expect(() => parseResearchModelInventoryArgs(['--environment', 'staging'])).toThrow(
      '--environment requires',
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchModelInventoryArgs(['--environment', 'beta', '--nope'])).toThrow(
      'Unknown argument: --nope',
    );
  });
});

describe('buildResearchModelInventoryOutput', () => {
  it('wraps the report with metadata and a stable generatedAt', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    const output = buildResearchModelInventoryOutput(report, {
      environment: 'beta',
      db: 'ylabs-beta',
      target: 'example.mongodb.net/ylabs-beta',
      generatedAt: '2026-07-24T00:00:00.000Z',
      options: { environment: 'beta', sampleLimit: 20 },
    });
    expect(output.generatedAt).toBe('2026-07-24T00:00:00.000Z');
    expect(output.environment).toBe('beta');
    expect(output.db).toBe('ylabs-beta');
    expect(output.target).toBe('example.mongodb.net/ylabs-beta');
    expect(output.options.sampleLimit).toBe(20);
    expect(output.summary.collectionsClassified).toBe(INVENTORY_COLLECTIONS.length);
  });

  it('omits optional database metadata when not provided', () => {
    const report = buildResearchModelInventoryReport(emptyFacts());
    const output = buildResearchModelInventoryOutput(report, {
      environment: 'test',
      options: { environment: 'test', sampleLimit: 20 },
    });
    expect(output.environment).toBe('test');
    expect('db' in output).toBe(false);
    expect('target' in output).toBe(false);
    expect(typeof output.generatedAt).toBe('string');
  });
});
