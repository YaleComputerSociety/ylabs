import { describe, expect, it, vi } from 'vitest';
import {
  createPageShellLookupLimiter,
  createPageShellResolutionCache,
  resolvePageShell,
  type PageShellMetadataDependencies,
  type ServedResearchShellFields,
} from '../pageShellMetadataService';

const SERVED_SLUG = 'synthetic-tide-pool-lab';
const CLIENT_KEY = '203.0.113.7';
const SERVED_ROW: ServedResearchShellFields = {
  name: 'Synthetic Tide Pool Lab',
  kind: 'lab',
  entityType: 'LAB',
  shortDescription: 'Studies intertidal invertebrate communities.',
};

const dependencies = (
  overrides: Partial<PageShellMetadataDependencies> = {},
): PageShellMetadataDependencies => ({
  readServedResearchEntity: vi.fn(async (slug: string) =>
    slug === SERVED_SLUG ? SERVED_ROW : null,
  ),
  readArchivedCanonicalSlug: vi.fn(async () => null),
  lookupTimeoutMs: 50,
  cache: createPageShellResolutionCache(),
  lookupLimiter: createPageShellLookupLimiter(),
  ...overrides,
});

describe('resolvePageShell', () => {
  it('builds a served row head from its served title, short description and canonical page', async () => {
    const resolution = await resolvePageShell(
      `/research/${SERVED_SLUG}`,
      CLIENT_KEY,
      dependencies(),
    );

    expect(resolution).toEqual({
      kind: 'page',
      status: 200,
      head: {
        title: 'Synthetic Tide Pool Lab',
        description: 'Studies intertidal invertebrate communities.',
        canonicalPath: `/research/${SERVED_SLUG}`,
      },
    });
  });

  it('uses the served faculty research title rather than the stored name suffix', async () => {
    const resolution = await resolvePageShell(
      `/research/${SERVED_SLUG}`,
      CLIENT_KEY,
      dependencies({
        readServedResearchEntity: async () => ({
          name: 'Avery Synthetic Faculty Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH',
        }),
      }),
    );

    expect(resolution.kind === 'page' && resolution.head.title).toBe('Avery Synthetic');
  });

  it('answers a row the public detail read withholds with a 404 and the generic shell', async () => {
    const resolution = await resolvePageShell('/research/withheld-row', CLIENT_KEY, dependencies());

    expect(resolution).toEqual({ kind: 'page', status: 404, head: {} });
  });

  it('answers a malformed slug with a 404 without reading the database', async () => {
    const deps = dependencies();
    const resolution = await resolvePageShell('/research/%E0%A4%A', CLIENT_KEY, deps);

    expect(resolution.status).toBe(404);
    expect(deps.readServedResearchEntity).not.toHaveBeenCalled();
  });

  it('redirects an archived slug permanently to its canonical page', async () => {
    const resolution = await resolvePageShell(
      '/research/merged-shell',
      CLIENT_KEY,
      dependencies({ readArchivedCanonicalSlug: async () => SERVED_SLUG }),
    );

    expect(resolution).toEqual({
      kind: 'redirect',
      status: 301,
      location: `/research/${SERVED_SLUG}`,
    });
  });

  it('serves the unmodified shell when the lookup throws', async () => {
    const resolution = await resolvePageShell(
      `/research/${SERVED_SLUG}`,
      CLIENT_KEY,
      dependencies({
        readServedResearchEntity: async () => {
          throw new Error('database unavailable');
        },
      }),
    );

    expect(resolution).toEqual({ kind: 'page', status: 200, head: {} });
  });

  it('serves the unmodified shell when the lookup outlasts its budget', async () => {
    const resolution = await resolvePageShell(
      `/research/${SERVED_SLUG}`,
      CLIENT_KEY,
      dependencies({
        readServedResearchEntity: () => new Promise(() => {}),
        lookupTimeoutMs: 5,
      }),
    );

    expect(resolution).toEqual({ kind: 'page', status: 200, head: {} });
  });

  it('never carries contact data from a served description into the head', async () => {
    for (const shortDescription of [
      'Write to synthetic.person@example.edu to join.',
      'Call (203) 555-0100 for openings.',
    ]) {
      const resolution = await resolvePageShell(
        `/research/${SERVED_SLUG}`,
        CLIENT_KEY,
        dependencies({
          readServedResearchEntity: async () => ({ ...SERVED_ROW, shortDescription }),
        }),
      );

      expect(resolution.kind === 'page' && resolution.head.description).toBeUndefined();
    }
  });

  it('gives each public listing page its own title and a query-free canonical path', async () => {
    expect(await resolvePageShell('/research', CLIENT_KEY, dependencies())).toEqual({
      kind: 'page',
      status: 200,
      head: { title: 'Research', canonicalPath: '/research' },
    });
    expect(await resolvePageShell('/research/', CLIENT_KEY, dependencies())).toEqual(
      await resolvePageShell('/research', CLIENT_KEY, dependencies()),
    );
    expect(await resolvePageShell('/programs', CLIENT_KEY, dependencies())).toEqual({
      kind: 'page',
      status: 200,
      head: { title: 'Programs & Fellowships', canonicalPath: '/programs' },
    });
  });

  it('leaves every other page on the unmodified shell', async () => {
    const deps = dependencies();
    for (const pagePath of ['/dashboard', '/analytics', '/research/person/abc', '/no-such-page']) {
      expect(await resolvePageShell(pagePath, CLIENT_KEY, deps)).toEqual({
        kind: 'page',
        status: 200,
        head: {},
      });
    }
    expect(deps.readServedResearchEntity).not.toHaveBeenCalled();
  });
});

describe('resolvePageShell lookup budget', () => {
  it('reads the detail once for repeated requests to the same slug', async () => {
    const deps = dependencies();

    const first = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    const second = await resolvePageShell(`/research/${SERVED_SLUG}/`, CLIENT_KEY, deps);

    expect(second).toEqual(first);
    expect(first.status).toBe(200);
    expect(deps.readServedResearchEntity).toHaveBeenCalledTimes(1);
  });

  it('caches the 404 and 301 outcomes too', async () => {
    const deps = dependencies({
      readArchivedCanonicalSlug: vi.fn(async (slug: string) =>
        slug === 'merged-shell' ? SERVED_SLUG : null,
      ),
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await resolvePageShell('/research/withheld-row', CLIENT_KEY, deps)).status).toBe(404);
      expect((await resolvePageShell('/research/merged-shell', CLIENT_KEY, deps)).status).toBe(301);
    }
    expect(deps.readServedResearchEntity).toHaveBeenCalledTimes(2);
    expect(deps.readArchivedCanonicalSlug).toHaveBeenCalledTimes(2);
  });

  it('shares one detail read between concurrent requests for the same slug', async () => {
    let release: (fields: ServedResearchShellFields) => void = () => {};
    const readServedResearchEntity = vi.fn(
      () =>
        new Promise<ServedResearchShellFields | null>((resolve) => {
          release = resolve;
        }),
    );
    const deps = dependencies({ readServedResearchEntity, lookupTimeoutMs: 1000 });

    const requests = [
      resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps),
      resolvePageShell(`/research/${SERVED_SLUG}`, '198.51.100.4', deps),
    ];
    release(SERVED_ROW);
    const [first, second] = await Promise.all(requests);

    expect(readServedResearchEntity).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second).toEqual(first);
  });

  it('serves an over-limit client the unmodified shell without reading the detail', async () => {
    const deps = dependencies({ lookupLimiter: createPageShellLookupLimiter({ maxLookups: 1 }) });

    await resolvePageShell('/research/first-row', CLIENT_KEY, deps);
    const overLimit = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    const otherClient = await resolvePageShell(`/research/${SERVED_SLUG}`, '198.51.100.4', deps);

    expect(overLimit).toEqual({ kind: 'page', status: 200, head: {} });
    expect(otherClient.status).toBe(200);
    expect(otherClient.kind === 'page' && otherClient.head.title).toBe('Synthetic Tide Pool Lab');
    expect(deps.readServedResearchEntity).toHaveBeenCalledTimes(2);
  });

  it('serves an over-limit client a slug that is already cached', async () => {
    const deps = dependencies({ lookupLimiter: createPageShellLookupLimiter({ maxLookups: 1 }) });

    const first = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    const repeat = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);

    expect(repeat).toEqual(first);
    expect(deps.readServedResearchEntity).toHaveBeenCalledTimes(1);
  });

  it('never caches a lookup that throws or outlasts its budget', async () => {
    const failing = vi
      .fn<(slug: string) => Promise<ServedResearchShellFields | null>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(SERVED_ROW);
    const deps = dependencies({ readServedResearchEntity: failing, lookupTimeoutMs: 5 });

    const thrown = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    const timedOut = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    const recovered = await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);

    expect(thrown).toEqual({ kind: 'page', status: 200, head: {} });
    expect(timedOut).toEqual({ kind: 'page', status: 200, head: {} });
    expect(recovered.kind === 'page' && recovered.head.title).toBe('Synthetic Tide Pool Lab');
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it('reads the detail again once a cached resolution expires', async () => {
    let clock = 0;
    const deps = dependencies({
      cache: createPageShellResolutionCache({ ttlMs: 1000, now: () => clock }),
    });

    await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    clock = 999;
    await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);
    clock = 1000;
    await resolvePageShell(`/research/${SERVED_SLUG}`, CLIENT_KEY, deps);

    expect(deps.readServedResearchEntity).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest cached slug once the cache is full', async () => {
    const deps = dependencies({ cache: createPageShellResolutionCache({ maxEntries: 2 }) });

    for (const slug of ['row-a', 'row-b', 'row-c', 'row-b', 'row-a']) {
      await resolvePageShell(`/research/${slug}`, CLIENT_KEY, deps);
    }

    expect(vi.mocked(deps.readServedResearchEntity).mock.calls.map(([slug]) => slug)).toEqual([
      'row-a',
      'row-b',
      'row-c',
      'row-a',
    ]);
  });
});
