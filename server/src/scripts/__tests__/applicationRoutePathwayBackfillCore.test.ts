import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  applicationRouteBackfillDerivationKey,
  backfillApplicationRoutePathways,
  classifyApplicationRoutePathway,
  type ApplicationRoutePathwayBackfillDeps,
  type ApplicationRoutePathwayBackfillRoute,
} from '../applicationRoutePathwayBackfillCore';
import {
  assertApplicationRoutePathwayBackfillApplyAllowed,
  buildApplicationRoutePathwayBackfillOutput,
  parseApplicationRoutePathwayBackfillArgs,
  writeApplicationRoutePathwayBackfillOutput,
} from '../backfillApplicationRoutePathways';

function queryResult<T>(value: T) {
  return {
    select: () => ({
      sort: () => ({
        limit: () => ({
          lean: async () => value,
        }),
      }),
      lean: async () => value,
    }),
    lean: async () => value,
  };
}

function findByIdResult<T>(value: T) {
  return {
    select: () => ({
      lean: async () => value,
    }),
  };
}

function route(overrides: Partial<ApplicationRoutePathwayBackfillRoute> = {}) {
  return {
    _id: 'route-1',
    researchEntityId: 'entity-1',
    routeType: 'OFFICIAL_APPLICATION',
    url: 'https://medicine.yale.edu/lab/example/join-us/',
    sourceUrl: 'https://medicine.yale.edu/lab/example/join-us/',
    sourceEvidenceIds: ['obs-1'],
    observedAt: new Date('2026-05-26T00:00:00.000Z'),
    sourceName: 'lab-microsite-undergrad-llm',
    ...overrides,
  };
}

function depsFor(options: {
  routes?: ApplicationRoutePathwayBackfillRoute[];
  entity?: any;
  refetchedRoute?: any;
  updateResult?: any;
} = {}): ApplicationRoutePathwayBackfillDeps & {
  writes: any[];
  materializeAccessForResearchGroup: ReturnType<typeof vi.fn>;
} {
  const writes: any[] = [];
  return {
    writes,
    contactRouteModel: {
      find: vi.fn(() => queryResult(options.routes || [route()])),
      findById: vi.fn(() => findByIdResult(options.refetchedRoute || { _id: 'route-1' })),
      updateOne: vi.fn(async (...args: any[]) => {
        writes.push(['route.updateOne', ...args]);
        return options.updateResult || { matchedCount: 1, modifiedCount: 1 };
      }),
    },
    researchEntityModel: {
      findOne: vi.fn(() => ({
        select: () => ({
          lean: async () => options.entity ?? { _id: 'entity-1', archived: false },
        }),
      })),
    },
    materializeAccessForResearchGroup: vi.fn(async () => ({
      researchEntityId: 'entity-1',
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: 0,
      errors: 0,
    })),
    upsertEntryPathway: vi.fn(async (input: any) => {
      writes.push(['pathway', input]);
      return { pathwayId: 'pathway-1' };
    }),
    upsertAccessSignal: vi.fn(async (input: any) => {
      writes.push(['signal', input]);
      return { signalId: 'signal-1' };
    }),
  } as any;
}

describe('application route pathway backfill', () => {
  it('classifies department undergraduate research routes as recurring programs', () => {
    expect(
      classifyApplicationRoutePathway(
        route({
          url: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
          sourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
        }),
      ),
    ).toMatchObject({
      pathwayType: 'RECURRING_PROGRAM',
      status: 'RECURRING',
      studentFacingLabel: 'Department research application',
    });
  });

  it('dry-runs candidates without materialization or writes', async () => {
    const deps = depsFor();

    const result = await backfillApplicationRoutePathways({ dryRun: true, limit: 10 }, deps);

    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      candidates: 1,
      rematerialized: 0,
      routeBackfilled: 0,
      blocked: 0,
      candidateRouteIds: ['route-1'],
    });
    expect(deps.materializeAccessForResearchGroup).not.toHaveBeenCalled();
    expect(deps.writes).toEqual([]);
  });

  it('rejects unsafe runtime limits before querying contact routes', async () => {
    const deps = depsFor();

    await expect(
      backfillApplicationRoutePathways({ dryRun: true, limit: 9007199254740992 }, deps),
    ).rejects.toThrow('--limit must be a safe positive integer');

    expect(deps.contactRouteModel.find).not.toHaveBeenCalled();
  });

  it('counts rematerialized routes when normal access materialization links the route', async () => {
    const deps = depsFor({ refetchedRoute: { _id: 'route-1', entryPathwayId: 'pathway-normal' } });

    const result = await backfillApplicationRoutePathways({ dryRun: false, limit: 10 }, deps);

    expect(result.rematerialized).toBe(1);
    expect(result.routeBackfilled).toBe(0);
    expect(result.rematerializedRouteIds).toEqual(['route-1']);
    expect(deps.writes).toEqual([]);
  });

  it('falls back to a source-backed official route pathway when rematerialization does not link', async () => {
    const deps = depsFor();

    const result = await backfillApplicationRoutePathways({ dryRun: false, limit: 10 }, deps);

    expect(result.routeBackfilled).toBe(1);
    expect(result.routeBackfilledRouteIds).toEqual(['route-1']);
    expect(deps.writes[0]).toEqual([
      'pathway',
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'VOLUNTEER_OUTREACH',
        status: 'PLAUSIBLE',
        derivationKey: 'application-route-backfill:obs-1',
        sourceEvidenceIds: ['obs-1'],
      }),
    ]);
    expect(deps.writes[1]).toEqual([
      'signal',
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        signalType: 'APPLICATION_FORM_EXISTS',
        derivationKey: 'application-route-backfill:obs-1:APPLICATION_FORM_EXISTS',
      }),
    ]);
    expect(deps.writes[2]).toEqual([
      'route.updateOne',
      { _id: 'route-1' },
      { $set: expect.objectContaining({ entryPathwayId: 'pathway-1' }) },
    ]);
  });

  it('blocks routes without source evidence or a trusted official URL', async () => {
    const deps = depsFor({
      routes: [
        route({ _id: 'route-missing-evidence', sourceEvidenceIds: [] }),
        route({
          _id: 'route-untrusted',
          url: 'https://example.test/apply',
          sourceUrl: 'https://example.test/source',
        }),
        route({
          _id: 'route-credentialed',
          url: 'https://user:pass@medicine.yale.edu/lab/example/join-us/',
          sourceUrl: 'https://medicine.yale.edu/lab/example/join-us/',
        }),
      ],
    });

    const result = await backfillApplicationRoutePathways({ dryRun: false, limit: 10 }, deps);

    expect(result).toMatchObject({
      blocked: 3,
      blockerReasons: {
        'missing-source-evidence': 1,
        'untrusted-application-url': 2,
      },
      routeBackfilled: 0,
    });
    expect(deps.materializeAccessForResearchGroup).not.toHaveBeenCalled();
    expect(deps.writes).toEqual([]);
  });

  it('uses source evidence, not contact route id, as the application-route backfill identity', () => {
    expect(applicationRouteBackfillDerivationKey(route({ _id: 'route-a' }))).toBe(
      'application-route-backfill:obs-1',
    );
    expect(applicationRouteBackfillDerivationKey(route({ _id: 'route-b' }))).toBe(
      'application-route-backfill:obs-1',
    );
    expect(
      applicationRouteBackfillDerivationKey(route({ _id: 'route-c', sourceEvidenceIds: [] })),
    ).toBe('application-route-backfill:route-c');
  });

  it('parses dry-run/apply, limit, and output flags for review artifact generation', () => {
    expect(
      parseApplicationRoutePathwayBackfillArgs([
        '--apply',
        '--confirm-application-route-backfill',
        '--limit=25',
        '--output',
        '/tmp/ylabs-application-route-backfill.json',
      ]),
    ).toEqual({
      dryRun: false,
      limit: 25,
      explicitLimit: true,
      confirmApplicationRouteBackfill: true,
      output: '/tmp/ylabs-application-route-backfill.json',
    });
    expect(() => parseApplicationRoutePathwayBackfillArgs(['prod'])).toThrow(
      /Unknown application-route pathway backfill argument: prod/,
    );
    expect(() => parseApplicationRoutePathwayBackfillArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseApplicationRoutePathwayBackfillArgs(['--limit=9007199254740992'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseApplicationRoutePathwayBackfillArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseApplicationRoutePathwayBackfillArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseApplicationRoutePathwayBackfillArgs(['--output', '/var/tmp/application-route.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseApplicationRoutePathwayBackfillArgs(['--output', '/tmp/application-route.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the application-route backfill artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-application-route-backfill-'));
    const output = path.join(dir, 'application-route-backfill.json');
    writeApplicationRoutePathwayBackfillOutput(
      {
        dryRun: true,
        scanned: 2,
        candidates: 2,
        routeBackfilled: 0,
        blocked: 1,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      dryRun: true,
      scanned: 2,
      candidates: 2,
      blocked: 1,
    });
  });

  it('rejects unsafe application-route backfill artifact writes', () => {
    expect(() =>
      writeApplicationRoutePathwayBackfillOutput({ dryRun: true }, '/var/tmp/application-route.json'),
    ).toThrow(/--output must write under/);
  });

  it('adds target metadata to application-route backfill artifacts', () => {
    const payload = buildApplicationRoutePathwayBackfillOutput(
      {
        dryRun: true,
        scanned: 2,
        candidates: 2,
        routeBackfilled: 0,
        blocked: 1,
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          dryRun: true,
          limit: 25,
          explicitLimit: true,
          confirmApplicationRouteBackfill: false,
          output: '/tmp/ylabs-application-route-backfill.json',
        },
      },
    );

    expect(payload).toMatchObject({
      dryRun: true,
      scanned: 2,
      candidates: 2,
      blocked: 1,
      environment: 'beta',
      db: 'Beta',
      options: {
        dryRun: true,
        limit: 25,
        explicitLimit: true,
        confirmApplicationRouteBackfill: false,
        output: '/tmp/ylabs-application-route-backfill.json',
      },
    });
  });

  it('blocks application-route backfill apply against production without confirmation', () => {
    expect(() =>
      assertApplicationRoutePathwayBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 10,
          explicitLimit: true,
          confirmApplicationRouteBackfill: true,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires an explicit limit before application-route backfill apply', () => {
    expect(parseApplicationRoutePathwayBackfillArgs(['--apply'])).toMatchObject({
      dryRun: false,
      limit: 150,
      explicitLimit: false,
      confirmApplicationRouteBackfill: false,
    });

    expect(() =>
      assertApplicationRoutePathwayBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 150,
          explicitLimit: false,
          confirmApplicationRouteBackfill: true,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);
  });

  it('requires explicit confirmation before application-route backfill apply', () => {
    expect(() =>
      assertApplicationRoutePathwayBackfillApplyAllowed(
        {
          dryRun: false,
          limit: 25,
          explicitLimit: true,
          confirmApplicationRouteBackfill: false,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-application-route-backfill is required/);
  });
});
