import type mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AccessSignal } from '../accessSignal';
import { AnalyticsEvent } from '../analytics';
import { ContactRoute } from '../contactRoute';
import { Department } from '../department';
import { EntryPathway } from '../entryPathway';
import { FacultyMember } from '../facultyMember';
import { Fellowship } from '../fellowship';
import { Grant } from '../grant';
import { Listing } from '../listing';
import { Observation } from '../observation';
import { Paper } from '../paper';
import { PaperAuthor } from '../paperAuthor';
import { PaperGroupLink } from '../paperGroupLink';
import { PostedOpportunity } from '../postedOpportunity';
import { ResearchArea } from '../researchArea';
import { ResearchEntity } from '../researchEntity';
import { ResearchGroupMember } from '../researchGroupMember';
import { ResearchGroupStats } from '../researchGroupStats';
import { ResearchScholarlyAttribution } from '../researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../researchScholarlyLink';
import { ScrapeRun } from '../scrapeRun';
import { ScrapeSnapshot } from '../scrapeSnapshot';
import { Source } from '../source';
import { StudentApplication } from '../studentApplication';
import { StudentEngagementEvent } from '../studentEngagementEvent';
import { StudentOutreach } from '../studentOutreach';
import { StudentProfile } from '../studentProfile';
import { StudentTracking } from '../studentTracking';
import { User } from '../user';

const models: Array<[mongoose.Model<any>, string]> = [
  [AccessSignal, 'access_signals'],
  [AnalyticsEvent, 'analytics_events'],
  [ContactRoute, 'contact_routes'],
  [Department, 'departments'],
  [EntryPathway, 'entry_pathways'],
  [FacultyMember, 'faculty_members'],
  [Fellowship, 'fellowships'],
  [Grant, 'grants'],
  [Listing, 'listings'],
  [Observation, 'observations'],
  [Paper, 'papers'],
  [PaperAuthor, 'paper_authors'],
  [PaperGroupLink, 'paper_entity_links'],
  [PostedOpportunity, 'posted_opportunities'],
  [ResearchArea, 'research_areas'],
  [ResearchEntity, 'research_entities'],
  [ResearchGroupMember, 'research_entity_members'],
  [ResearchGroupStats, 'research_entity_stats'],
  [ResearchScholarlyAttribution, 'research_scholarly_attributions'],
  [ResearchScholarlyLink, 'research_scholarly_links'],
  [ScrapeRun, 'scrape_runs'],
  [ScrapeSnapshot, 'scrape_snapshots'],
  [Source, 'sources'],
  [StudentApplication, 'student_applications'],
  [StudentEngagementEvent, 'student_engagement_events'],
  [StudentOutreach, 'student_outreaches'],
  [StudentProfile, 'student_profiles'],
  [StudentTracking, 'student_trackings'],
  [User, 'users'],
];

function schemaPathSegments(model: mongoose.Model<any>): string[] {
  return Object.keys(model.schema.paths)
    .flatMap((path) => path.split('.'))
    .filter((segment) => segment !== '$*');
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
});
