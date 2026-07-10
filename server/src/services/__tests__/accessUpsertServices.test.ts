import { describe, expect, it } from 'vitest';
import { upsertAccessSignal } from '../accessSignalService';
import { upsertContactRoute } from '../contactRouteService';
import { upsertEntryPathway } from '../entryPathwayService';

describe('access upsert services', () => {
  it('does not set access-signal link fields in conflicting upsert operators', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'signal-1' }),
        };
      },
    };

    await upsertAccessSignal(
      {
        researchEntityId: 'research-1',
        entryPathwayId: 'entry-1',
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        derivationKey: 'listing:listing-1:POSTED_OPENING',
      },
      { model: model as any },
    );

    expect(capturedUpdate.$set.entryPathwayId).toBe('entry-1');
    expect(capturedUpdate.$setOnInsert.entryPathwayId).toBeUndefined();
    expect(capturedUpdate.$setOnInsert.sourceEvidenceId).toBeUndefined();
    expect(capturedUpdate.$setOnInsert.observationId).toBeUndefined();
  });

  it('does not set contact-route link fields in conflicting upsert operators', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'route-1' }),
        };
      },
    };

    await upsertContactRoute(
      {
        researchEntityId: 'research-1',
        entryPathwayId: 'entry-1',
        routeType: 'OFFICIAL_APPLICATION',
        priority: 10,
        visibility: 'PUBLIC',
        contactPolicy: 'APPLICATION_ONLY',
        sourceEvidenceIds: [],
        derivationKey: 'route:1',
      },
      { model: model as any },
    );

    expect(capturedUpdate.$set.entryPathwayId).toBe('entry-1');
    expect(capturedUpdate.$setOnInsert.entryPathwayId).toBeUndefined();
    expect(capturedUpdate.$setOnInsert.sourceEvidenceId).toBeUndefined();
  });

  it('sanitizes public access artifact text and URLs before persistence', async () => {
    const capturedUpdates: Record<string, any> = {};
    const modelFor = (key: string) =>
      ({
        findOneAndUpdate: (_filter: any, update: any) => {
          capturedUpdates[key] = update;
          return {
            lean: async () => ({ _id: `${key}-1` }),
          };
        },
      }) as any;

    await upsertAccessSignal(
      {
        researchEntityId: 'research-1',
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'HIGH',
        observedAt: new Date('2026-05-12T00:00:00.000Z'),
        excerpt: 'Questions: hidden@example.edu or 203-432-1234.',
        sourceUrl: 'mailto:hidden@example.edu',
      },
      { model: modelFor('signal') },
    );
    await upsertEntryPathway(
      {
        researchEntityId: 'research-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'ACTIVE',
        evidenceStrength: 'DIRECT',
        studentFacingLabel: 'Email hidden@example.edu',
        explanation: 'Call 203-432-1234 before applying.',
        bestNextStep: 'Use the official form.',
        sourceEvidenceIds: [],
        sourceUrls: [
          'javascript:alert(document.cookie)',
          'mailto:hidden@example.edu',
          'https://lab.example.test/join',
        ],
      },
      { model: modelFor('pathway') },
    );
    await upsertContactRoute(
      {
        researchEntityId: 'research-1',
        routeType: 'FACULTY_PI',
        priority: 1,
        visibility: 'PUBLIC',
        contactPolicy: 'DIRECT_CONTACT_OK',
        name: 'Professor hidden@example.edu',
        email: 'mailto:hidden@example.edu?subject=Hi',
        role: 'PI 203-432-1234',
        url: 'javascript:alert(document.cookie)',
        rationale: 'Email hidden@example.edu for details.',
        sourceEvidenceIds: [],
        sourceUrl: 'data:text/html,<script>alert(1)</script>',
      },
      { model: modelFor('route') },
    );

    expect(capturedUpdates.signal.$set).toMatchObject({
      excerpt: 'Questions: [email redacted] or [phone redacted].',
    });
    expect(capturedUpdates.signal.$set.sourceUrl).toBeUndefined();
    expect(capturedUpdates.pathway.$set).toMatchObject({
      studentFacingLabel: 'Email [email redacted]',
      explanation: 'Call [phone redacted] before applying.',
      bestNextStep: 'Use the official form.',
    });
    expect(capturedUpdates.pathway.$addToSet.sourceUrls.$each).toEqual([
      'https://lab.example.test/join',
    ]);
    expect(capturedUpdates.route.$set).toMatchObject({
      name: 'Professor [email redacted]',
      personName: 'Professor [email redacted]',
      label: 'Professor [email redacted]',
      role: 'PI [phone redacted]',
      rationale: 'Email [email redacted] for details.',
    });
    expect(capturedUpdates.route.$set.email).toBeUndefined();
    expect(capturedUpdates.route.$set.url).toBeUndefined();
    expect(capturedUpdates.route.$set.sourceUrl).toBeUndefined();
    expect(JSON.stringify(capturedUpdates)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(capturedUpdates)).not.toContain('203-432-1234');
    expect(JSON.stringify(capturedUpdates)).not.toContain('javascript:');
    expect(JSON.stringify(capturedUpdates)).not.toContain('mailto:');
    expect(JSON.stringify(capturedUpdates)).not.toContain('data:text/html');
  });
});
