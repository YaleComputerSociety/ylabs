import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { selectPlanningContexts } from '../planningContextService';

const approved = { status: 'approved' };
const entityId = new Types.ObjectId();
const pathwayId = new Types.ObjectId();

describe('planningContextService qualification policy', () => {
  it('selects one deterministic signal with open-position precedence', () => {
    const contexts = selectPlanningContexts({
      pathways: [
        {
          _id: pathwayId,
          researchEntityId: entityId,
          pathwayType: 'POSTED_ROLE',
          status: 'ACTIVE',
          bestNextStep: 'Apply through the official form.',
          sourceUrls: ['https://research.yale.edu/apply'],
          evidenceStrength: 'DIRECT',
          confidence: 0.9,
          review: approved,
        },
      ],
      opportunities: [
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          entryPathwayId: pathwayId,
          status: 'OPEN',
          applicationUrl: 'https://research.yale.edu/jobs/1',
          review: approved,
        },
      ],
      routes: [
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          routeType: 'PROGRAM_MANAGER',
          visibility: 'PUBLIC',
          url: 'https://research.yale.edu/contact',
          sourceUrl: 'https://research.yale.edu/contact-policy',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          review: approved,
        },
      ],
    });

    expect(contexts.get(entityId.toString())).toEqual({
      category: 'open_position',
      label: 'Open position',
      url: 'https://research.yale.edu/jobs/1',
    });
    expect(contexts.size).toBe(1);
  });

  it('rejects PI provenance, generic pages, inferred outreach, and unapproved records', () => {
    const contexts = selectPlanningContexts({
      pathways: [
        {
          _id: pathwayId,
          researchEntityId: entityId,
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'ACTIVE',
          bestNextStep: 'Email the professor.',
          sourceUrls: ['https://medicine.yale.edu/profile/person'],
          review: approved,
        },
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          pathwayType: 'RECURRING_PROGRAM',
          status: 'RECURRING',
          bestNextStep: 'Apply each spring.',
          sourceUrls: ['https://research.yale.edu/program'],
          review: { status: 'unreviewed' },
        },
      ],
      opportunities: [],
      routes: [
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          routeType: 'FACULTY_PI',
          visibility: 'PUBLIC',
          email: 'private@yale.edu',
          url: 'https://medicine.yale.edu/profile/person',
          sourceUrl: 'https://medicine.yale.edu/profile/person',
          contactPolicy: 'DIRECT_CONTACT_OK',
          review: approved,
        },
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          routeType: 'PROGRAM_MANAGER',
          visibility: 'ADMIN_ONLY',
          url: 'https://research.yale.edu/contact',
          review: approved,
        },
      ],
    });

    expect(contexts.size).toBe(0);
  });

  it('requires a safe URL and emits no private details or review metadata', () => {
    const contexts = selectPlanningContexts({
      pathways: [],
      opportunities: [],
      routes: [
        {
          _id: new Types.ObjectId(),
          researchEntityId: entityId,
          routeType: 'PROGRAM_MANAGER',
          visibility: 'PUBLIC',
          email: 'private@yale.edu',
          personName: 'Private Person',
          rationale: 'Internal review note',
          url: 'https://research.yale.edu/contact',
          sourceUrl: 'https://research.yale.edu/contact',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          review: { ...approved, note: 'Do not expose' },
        },
      ],
    });

    const context = contexts.get(entityId.toString());
    expect(context).toEqual({
      category: 'reviewed_route',
      label: 'Official contact route',
      url: 'https://research.yale.edu/contact',
    });
    expect(JSON.stringify(context)).not.toContain('private@yale.edu');
    expect(JSON.stringify(context)).not.toContain('Do not expose');
    expect(JSON.stringify(context)).not.toContain('Private Person');
  });

  it('rejects expired, unsafe, orphaned, and unreviewed opportunities', () => {
    const validPathway = {
      _id: pathwayId,
      researchEntityId: entityId,
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      sourceUrls: ['https://research.yale.edu/apply'],
      evidenceStrength: 'DIRECT',
      confidence: 0.9,
      review: approved,
    };
    const opportunities = ['CLOSED', 'ARCHIVED'].map((status) => ({
      _id: new Types.ObjectId(),
      researchEntityId: entityId,
      entryPathwayId: pathwayId,
      status,
      applicationUrl: 'https://research.yale.edu/apply',
      review: approved,
    }));
    opportunities.push({
      _id: new Types.ObjectId(),
      researchEntityId: entityId,
      entryPathwayId: pathwayId,
      status: 'OPEN',
      applicationUrl: 'http://localhost/apply',
      review: approved,
    });

    expect(
      selectPlanningContexts({ pathways: [validPathway], opportunities, routes: [] }).size,
    ).toBe(0);
  });
});
