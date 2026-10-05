import { describe, expect, it, vi } from 'vitest';
import {
  resolvePageShell,
  type PageShellMetadataDependencies,
  type ServedResearchShellFields,
} from '../pageShellMetadataService';

const SERVED_SLUG = 'synthetic-tide-pool-lab';
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
  ...overrides,
});

describe('resolvePageShell', () => {
  it('builds a served row head from its served title, short description and canonical page', async () => {
    const resolution = await resolvePageShell(`/research/${SERVED_SLUG}`, dependencies());

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
    const resolution = await resolvePageShell('/research/withheld-row', dependencies());

    expect(resolution).toEqual({ kind: 'page', status: 404, head: {} });
  });

  it('answers a malformed slug with a 404 without reading the database', async () => {
    const deps = dependencies();
    const resolution = await resolvePageShell('/research/%E0%A4%A', deps);

    expect(resolution.status).toBe(404);
    expect(deps.readServedResearchEntity).not.toHaveBeenCalled();
  });

  it('redirects an archived slug permanently to its canonical page', async () => {
    const resolution = await resolvePageShell(
      '/research/merged-shell',
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
        dependencies({
          readServedResearchEntity: async () => ({ ...SERVED_ROW, shortDescription }),
        }),
      );

      expect(resolution.kind === 'page' && resolution.head.description).toBeUndefined();
    }
  });

  it('gives each public listing page its own title and a query-free canonical path', async () => {
    expect(await resolvePageShell('/research', dependencies())).toEqual({
      kind: 'page',
      status: 200,
      head: { title: 'Research', canonicalPath: '/research' },
    });
    expect(await resolvePageShell('/research/', dependencies())).toEqual(
      await resolvePageShell('/research', dependencies()),
    );
    expect(await resolvePageShell('/programs', dependencies())).toEqual({
      kind: 'page',
      status: 200,
      head: { title: 'Programs & Fellowships', canonicalPath: '/programs' },
    });
  });

  it('leaves every other page on the unmodified shell', async () => {
    const deps = dependencies();
    for (const pagePath of ['/dashboard', '/analytics', '/research/person/abc', '/no-such-page']) {
      expect(await resolvePageShell(pagePath, deps)).toEqual({
        kind: 'page',
        status: 200,
        head: {},
      });
    }
    expect(deps.readServedResearchEntity).not.toHaveBeenCalled();
  });
});
