import { describe, expect, it } from 'vitest';
import { upsertContactRoute } from '../contactRouteService';

describe('contactRouteService', () => {
  it('does not upsert when required research entity ids are object-shaped', async () => {
    const model = {
      findOneAndUpdate: () => {
        throw new Error('should not query');
      },
    };

    const result = await upsertContactRoute(
      {
        researchEntityId: { toString: () => '64f111111111111111111111' } as any,
        routeType: 'FACULTY_PI',
        priority: 1,
        visibility: 'PUBLIC',
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        sourceEvidenceIds: [],
      },
      { model: model as any },
    );

    expect(result).toEqual({});
  });

  it('skips object-shaped source evidence ids before Mongo update construction', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'contact-route-1' }),
        };
      },
    };

    await upsertContactRoute(
      {
        researchEntityId: 'entity-1',
        routeType: 'FACULTY_PI',
        priority: 1,
        visibility: 'PUBLIC',
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        sourceEvidenceIds: [
          { toString: () => '64f111111111111111111111' },
          '64f222222222222222222222',
        ] as any,
      },
      { model: model as any },
    );

    expect(capturedUpdate.$addToSet.sourceEvidenceIds.$each.map(String)).toEqual([
      '64f222222222222222222222',
    ]);
  });

  it('does not stringify object-shaped returned contact-route ids', async () => {
    const unsafeId = {
      toString: () => {
        throw new Error('stringified arbitrary contact-route id');
      },
      toHexString: () => {
        throw new Error('called arbitrary contact-route id toHexString');
      },
    };
    const model = {
      findOneAndUpdate: () => ({
        lean: async () => ({ _id: unsafeId }),
      }),
    };

    const result = await upsertContactRoute(
      {
        researchEntityId: 'entity-1',
        routeType: 'FACULTY_PI',
        priority: 1,
        visibility: 'PUBLIC',
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        sourceEvidenceIds: [],
      },
      { model: model as any },
    );

    expect(result.contactRouteId).toBeUndefined();
  });
});
