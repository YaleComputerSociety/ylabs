import { describe, expect, it } from 'vitest';
import { upsertAccessSignal } from '../accessSignalService';
import { upsertContactRoute } from '../contactRouteService';

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
});
