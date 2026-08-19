import type mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Account } from '../account';
import { AccessSignal } from '../accessSignal';
import { AdminGrant } from '../adminGrant';
import { AnalyticsEvent } from '../analytics';
import { ContactRoute } from '../contactRoute';
import { Department } from '../department';
import { EntryPathway } from '../entryPathway';
import { EvidenceClaim } from '../evidenceClaim';
import { FacultyMember } from '../facultyMember';
import { Fellowship } from '../fellowship';
import { Grant } from '../grant';
import { Listing } from '../listing';
import { Observation } from '../observation';
import { OrgUnit } from '../orgUnit';
import { Paper } from '../paper';
import { PaperAuthor } from '../paperAuthor';
import { PostedOpportunity } from '../postedOpportunity';
import { Researcher } from '../researcher';
import { ResearchArea } from '../researchArea';
import { ResearchEntity } from '../researchEntity';
import { ResearchGroupMember } from '../researchGroupMember';
import { RoleAssignment } from '../roleAssignment';
import { ResearchPlan } from '../researchPlan';
import { ReviewDecision } from '../reviewDecision';
import { ScrapeRun } from '../scrapeRun';
import { ScrapeSnapshot } from '../scrapeSnapshot';
import { Source } from '../source';
import { SourceDocument } from '../sourceDocument';
import { StudentApplication } from '../studentApplication';
import { StudentEngagementEvent } from '../studentEngagementEvent';
import { StudentOutreach } from '../studentOutreach';
import { StudentProfile } from '../studentProfile';
import { StudentTracking } from '../studentTracking';
import { TaxonomyTerm } from '../taxonomyTerm';
import { User } from '../user';
import { UndergraduateLogisticsClaim } from '../undergraduateLogisticsClaim';

const models: Array<[mongoose.Model<any>, string]> = [
  [Account, 'accounts'],
  [AccessSignal, 'access_signals'],
  [AdminGrant, 'admin_grants'],
  [AnalyticsEvent, 'analytics_events'],
  [ContactRoute, 'contact_routes'],
  [Department, 'departments'],
  [EntryPathway, 'entry_pathways'],
  [EvidenceClaim, 'evidence_claims'],
  [FacultyMember, 'faculty_members'],
  [Fellowship, 'fellowships'],
  [Grant, 'grants'],
  [Listing, 'listings'],
  [Observation, 'observations'],
  [OrgUnit, 'org_units'],
  [Paper, 'papers'],
  [PaperAuthor, 'paper_authors'],
  [PostedOpportunity, 'posted_opportunities'],
  [Researcher, 'researchers'],
  [ResearchArea, 'research_areas'],
  [ResearchEntity, 'research_entities'],
  [ResearchGroupMember, 'research_entity_members'],
  [RoleAssignment, 'role_assignments'],
  [ResearchPlan, 'research_plans'],
  [ReviewDecision, 'review_decisions'],
  [ScrapeRun, 'scrape_runs'],
  [ScrapeSnapshot, 'scrape_snapshots'],
  [Source, 'sources'],
  [SourceDocument, 'source_documents'],
  [StudentApplication, 'student_applications'],
  [StudentEngagementEvent, 'student_engagement_events'],
  [StudentOutreach, 'student_outreaches'],
  [StudentProfile, 'student_profiles'],
  [StudentTracking, 'student_trackings'],
  [TaxonomyTerm, 'taxonomy_terms'],
  [User, 'users'],
  [UndergraduateLogisticsClaim, 'undergraduate_logistics_claims'],
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
      expect(collectionName).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      expect(collectionName.endsWith('s')).toBe(true);
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
