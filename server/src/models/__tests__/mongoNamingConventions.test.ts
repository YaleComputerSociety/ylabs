import type mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AccessSignal } from '../accessSignal';
import { AnalyticsEvent } from '../analytics';
import { ContactRoute } from '../contactRoute';
import { Department } from '../department';
import { EntryPathway } from '../entryPathway';
import { Fellowship } from '../fellowship';
import { Observation } from '../observation';
import { PostedOpportunity } from '../postedOpportunity';
import { ResearchArea } from '../researchArea';
import { ResearchEntity } from '../researchEntity';
import { ResearchEntityRelationship } from '../researchEntityRelationship';
import { ResearchGroupMember } from '../researchGroupMember';
import { ResearchScholarlyAttribution } from '../researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../researchScholarlyLink';
import { ScrapeRun } from '../scrapeRun';
import { ScrapeSnapshot } from '../scrapeSnapshot';
import { Source } from '../source';
import { User } from '../user';

const models: Array<[mongoose.Model<any>, string]> = [
  [AccessSignal, 'access_signals'],
  [AnalyticsEvent, 'analytics_events'],
  [ContactRoute, 'contact_routes'],
  [Department, 'departments'],
  [EntryPathway, 'entry_pathways'],
  [Fellowship, 'fellowships'],
  [Observation, 'observations'],
  [PostedOpportunity, 'posted_opportunities'],
  [ResearchArea, 'research_areas'],
  [ResearchEntity, 'research_entities'],
  [ResearchEntityRelationship, 'research_entity_relationships'],
  [ResearchGroupMember, 'research_entity_members'],
  [ResearchScholarlyAttribution, 'research_scholarly_attributions'],
  [ResearchScholarlyLink, 'research_scholarly_links'],
  [ScrapeRun, 'scrape_runs'],
  [ScrapeSnapshot, 'scrape_snapshots'],
  [Source, 'sources'],
  [User, 'users'],
];

const retiredCollectionNames = new Set([
  'papers',
  'paper_authors',
  'paper_entity_links',
  'listings',
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
  'faculty_members',
  'grants',
  'research_entity_stats',
  'student_applications',
  'student_engagement_events',
  'student_outreaches',
  'student_profiles',
  'student_trackings',
]);

function schemaPathSegments(model: mongoose.Model<any>): string[] {
  return Object.keys(model.schema.paths)
    .flatMap((path) => path.split('.'))
    .filter((segment) => segment !== '$*');
}

function duplicateSchemaIndexes(model: mongoose.Model<any>): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const [fields] of model.schema.indexes()) {
    const signature = JSON.stringify(fields);
    if (seen.has(signature)) {
      duplicates.push(`${model.modelName} ${signature}`);
    }
    seen.add(signature);
  }

  return duplicates;
}

describe('Mongo naming conventions', () => {
  it('uses PascalCase singular Mongoose model names', () => {
    for (const [model] of models) {
      expect(model.modelName).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });

  it('uses lowercase plural snake_case Mongo collection names', () => {
    for (const [model, collectionName] of models) {
      expect(model.collection.name).toBe(collectionName);
      expect(collectionName).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*s$/);
    }
  });

  it('does not register retired physical collections', () => {
    const activeCollectionNames = models.map(([model]) => model.collection.name);
    expect(activeCollectionNames.filter((name) => retiredCollectionNames.has(name))).toEqual([]);
  });

  it('uses PascalCase model refs', () => {
    for (const [model] of models) {
      model.schema.eachPath((_, schemaType) => {
        const ref = schemaType.options?.ref;
        if (typeof ref === 'string') {
          expect(ref).toMatch(/^[A-Z][A-Za-z0-9]*$/);
        }
      });
    }
  });

  it('avoids dollar-prefixed or dollar-containing field names', () => {
    for (const [model] of models) {
      for (const segment of schemaPathSegments(model)) {
        expect(segment).not.toContain('$');
      }
    }
  });

  it('does not declare duplicate schema indexes', () => {
    const duplicateIndexes = models.flatMap(([model]) => duplicateSchemaIndexes(model));

    expect(duplicateIndexes).toEqual([]);
  });
});
