import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({ researchEntityFind: vi.fn() }));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { find: mocks.researchEntityFind },
}));

import {
  SERVICE_CORE_BEHIND_RESEARCH_ROWS,
  SERVICE_CORE_DEMOTION_WINDOW,
  demoteServiceCoresBelowResearch,
  orderServiceCoresBelowResearch,
  queryNamesTheRow,
  readServiceCoreFacts,
  researchTextIsCoreServiceText,
  serviceCoreDemotionExemption,
  serviceCoreDemotionReason,
  type ServiceCoreFacts,
} from '../serviceCoreDemotion';

describe('researchTextIsCoreServiceText', () => {
  it.each([
    'Provides electron microscopy services and one-on-one training in sample preparation.',
    'Provides maintenance and user support for flow cytometry instruments and performs sorting.',
    'The Example Printing Collaborative (EPC) provides engineering and 3D printing services for medical teams.',
    'Example Cytometry Facility offers a comprehensive range of services for cytometric analysis.',
  ])('flags a research text that opens with a core service offer: %s', (text) => {
    expect(researchTextIsCoreServiceText({ shortDescription: text })).toBe(true);
  });

  it('reads the full description too when the short one is a topic sentence', () => {
    expect(
      researchTextIsCoreServiceText({
        shortDescription: 'Cytometry measures physical characteristics of single cells.',
        fullDescription:
          'Example Cytometry Facility offers a range of services for sorting. It also trains users.',
      }),
    ).toBe(true);
  });

  it.each([
    'Provides education, forensic evaluations, clinical services, and research on forensic psychiatry.',
    'Studies ways to advance health equity through community-engaged scholarship and mentorship; provides clinical services.',
    'Studies protein folding with cryo-electron microscopy and provides training to undergraduates.',
    'Studies how cells sense force. The group also provides imaging services to collaborators.',
    'Develops methods for single-cell sequencing and the services that support them.',
  ])('does not flag research text: %s', (text) => {
    expect(researchTextIsCoreServiceText({ shortDescription: text, fullDescription: text })).toBe(
      false,
    );
  });

  it('ignores missing or non-string text', () => {
    expect(researchTextIsCoreServiceText({})).toBe(false);
    expect(researchTextIsCoreServiceText({ shortDescription: 42 as never })).toBe(false);
  });
});

describe('queryNamesTheRow', () => {
  const core = { name: 'Example Pluripotent Stem Cell Core' };

  it('does not treat a topic the title contains as naming the core', () => {
    expect(queryNamesTheRow(core, ['stem', 'cell'])).toBe(false);
    expect(
      queryNamesTheRow({ name: 'Mechanical and Thermal Analysis Core (MTAC)' }, [
        'mechanical',
        'engineering',
      ]),
    ).toBe(false);
  });

  it('treats every distinctive title word typed as naming the core', () => {
    expect(queryNamesTheRow(core, ['example', 'pluripotent', 'stem', 'cells'])).toBe(true);
    expect(
      queryNamesTheRow({ name: 'Example Microarray Shared Resource' }, ['example', 'microarray']),
    ).toBe(true);
  });

  it('treats a core kind word beside title words as naming the core', () => {
    expect(queryNamesTheRow(core, ['stem', 'cell', 'core'])).toBe(true);
    expect(queryNamesTheRow(core, ['brain', 'core'])).toBe(false);
  });

  it('treats the parenthesized acronym as naming the core', () => {
    expect(
      queryNamesTheRow({ name: 'Mechanical and Thermal Analysis Core (MTAC)' }, ['mtac']),
    ).toBe(true);
  });

  it('reads the display name as a title too', () => {
    expect(
      queryNamesTheRow({ name: 'Unrelated', displayName: 'Example Imaging Facility' }, [
        'example',
        'imaging',
      ]),
    ).toBe(true);
  });

  it('never names a row from an empty query', () => {
    expect(queryNamesTheRow(core, [])).toBe(false);
  });
});

describe('serviceCoreDemotionReason', () => {
  it('demotes a core facility by its type', () => {
    expect(
      serviceCoreDemotionReason({ entityType: 'CORE_FACILITY', name: 'Example Core' }, [
        'chemistry',
      ]),
    ).toBe('core-facility');
  });

  it('demotes a faculty research row whose research text is a core service offer', () => {
    expect(
      serviceCoreDemotionReason(
        {
          entityType: 'FACULTY_RESEARCH_AREA',
          name: 'Example Person',
          shortDescription: 'Provides electron microscopy services and training for users.',
        },
        ['microscopy'],
      ),
    ).toBe('core-service-text');
  });

  it('keeps a core the query names', () => {
    expect(
      serviceCoreDemotionReason({ entityType: 'CORE_FACILITY', name: 'Example Analytical Core' }, [
        'example',
        'analytical',
      ]),
    ).toBe('query-names-the-row');
  });

  it('never demotes another type, even with service text', () => {
    const text = 'Provides sequencing services to investigators.';
    expect(
      serviceCoreDemotionReason({ entityType: 'CENTER', shortDescription: text }, ['dna']),
    ).toBe('research');
    expect(serviceCoreDemotionReason({ entityType: 'LAB', shortDescription: text }, ['dna'])).toBe(
      'research',
    );
  });
});

describe('serviceCoreDemotionExemption', () => {
  it('exempts a name search', () => {
    expect(serviceCoreDemotionExemption({ answeredAsNameSearch: true, filters: {} })).toBe(
      'name-query',
    );
  });

  it('exempts a Type filter that selects cores, by entity type or kind', () => {
    expect(
      serviceCoreDemotionExemption({
        answeredAsNameSearch: false,
        filters: { entityType: ['LAB', 'CORE_FACILITY'] },
      }),
    ).toBe('type-filter-selects-cores');
    expect(
      serviceCoreDemotionExemption({
        answeredAsNameSearch: false,
        filters: { kind: ['core_facility'] },
      }),
    ).toBe('type-filter-selects-cores');
  });

  it('applies to a topic search with any other filter', () => {
    expect(
      serviceCoreDemotionExemption({
        answeredAsNameSearch: false,
        filters: { entityType: ['LAB'] },
      }),
    ).toBeNull();
    expect(serviceCoreDemotionExemption({ answeredAsNameSearch: false, filters: {} })).toBeNull();
  });
});

const ids = (hits: Array<{ id: string }>) => hits.map((hit) => hit.id);
const row = (id: string, entityType = 'LAB', extra: Record<string, unknown> = {}) => ({
  id,
  entityType,
  ...extra,
});

describe('demoteServiceCoresBelowResearch', () => {
  const isCore = (hit: { id: string }) => hit.id.startsWith('core');

  it('places a core below every research row of the span by default', () => {
    const research = Array.from({ length: 12 }, (_, index) => row(`r${index}`));
    const ordered = ids(
      demoteServiceCoresBelowResearch([row('core-a'), ...research], { isDemoted: isCore }),
    );
    expect(SERVICE_CORE_BEHIND_RESEARCH_ROWS).toBe(Number.POSITIVE_INFINITY);
    expect(ordered.indexOf('core-a')).toBe(12);
  });

  it('places every core below every research row when unbounded, keeping each group in order', () => {
    const hits = [row('core-a'), row('r1'), row('core-b'), row('r2'), row('r3')];
    expect(
      ids(
        demoteServiceCoresBelowResearch(hits, { isDemoted: isCore, behindResearchRows: Infinity }),
      ),
    ).toEqual(['r1', 'r2', 'r3', 'core-a', 'core-b']);
  });

  it('moves a core behind only the next K research rows when bounded', () => {
    const hits = [row('core-a'), row('r1'), row('r2'), row('r3'), row('core-b'), row('r4')];
    expect(
      ids(demoteServiceCoresBelowResearch(hits, { isDemoted: isCore, behindResearchRows: 2 })),
    ).toEqual(['r1', 'r2', 'core-a', 'r3', 'r4', 'core-b']);
  });

  it('is the identity at K = 0 and when nothing is demoted', () => {
    const hits = [row('core-a'), row('r1'), row('core-b')];
    expect(
      ids(demoteServiceCoresBelowResearch(hits, { isDemoted: isCore, behindResearchRows: 0 })),
    ).toEqual(ids(hits));
    const research = [row('r1'), row('r2')];
    expect(demoteServiceCoresBelowResearch(research, { isDemoted: isCore })).toBe(research);
  });

  it('never moves a core across a tier boundary', () => {
    const hits = [
      row('core-a', 'CORE_FACILITY', { tier: 1 }),
      row('r1', 'LAB', { tier: 1 }),
      row('r2', 'LAB', { tier: 0 }),
    ];
    expect(
      ids(
        demoteServiceCoresBelowResearch(hits, {
          isDemoted: isCore,
          behindResearchRows: Infinity,
          tierOf: (hit) => (hit as Record<string, unknown>).tier as number,
        }),
      ),
    ).toEqual(['r1', 'core-a', 'r2']);
  });

  it('serves the same rows it was given', () => {
    const hits = [row('core-a'), row('r1'), row('core-b'), row('r2')];
    const ordered = demoteServiceCoresBelowResearch(hits, {
      isDemoted: isCore,
      behindResearchRows: 1,
    });
    expect(new Set(ordered)).toEqual(new Set(hits));
    expect(ordered).toHaveLength(hits.length);
  });
});

describe('orderServiceCoresBelowResearch', () => {
  const factsFor = (entries: Record<string, ServiceCoreFacts>) =>
    vi.fn(
      async (requested: readonly string[]) =>
        new Map(requested.filter((id) => entries[id]).map((id) => [id, entries[id]])),
    );

  it('reads facts only for core and faculty rows in the window and demotes the cores', async () => {
    const readFacts = factsFor({
      'core-a': { entityType: 'CORE_FACILITY', name: 'Example Analytical Core' },
      p1: {
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Example Person',
        shortDescription: 'Studies chemistry.',
      },
    });
    const pool = [
      row('core-a', 'CORE_FACILITY'),
      row('lab-1'),
      row('p1', 'FACULTY_RESEARCH_AREA'),
      row('center-1', 'CENTER'),
    ];

    const ordered = await orderServiceCoresBelowResearch(pool, {
      queryTokens: ['chemistry'],
      idOf: (hit) => hit.id,
      readFacts,
    });

    expect(readFacts).toHaveBeenCalledWith(['core-a', 'p1']);
    expect(ids(ordered)).toEqual(['lab-1', 'p1', 'center-1', 'core-a']);
  });

  it('keeps a core the query names, and a row whose facts were not read', async () => {
    const pool = [row('core-a', 'CORE_FACILITY'), row('core-b', 'CORE_FACILITY'), row('lab-1')];
    const ordered = await orderServiceCoresBelowResearch(pool, {
      queryTokens: ['example', 'analytical'],
      idOf: (hit) => hit.id,
      readFacts: factsFor({
        'core-a': { entityType: 'CORE_FACILITY', name: 'Example Analytical Core' },
      }),
    });
    expect(ids(ordered)).toEqual(ids(pool));
  });

  it('leaves a core past the window where it is', async () => {
    const research = Array.from({ length: SERVICE_CORE_DEMOTION_WINDOW }, (_, index) =>
      row(`r${index}`),
    );
    const pool = [...research, row('core-late', 'CORE_FACILITY'), row('r-last')];
    const readFacts = factsFor({ 'core-late': { entityType: 'CORE_FACILITY', name: 'Late Core' } });

    const ordered = await orderServiceCoresBelowResearch(pool, {
      queryTokens: ['chemistry'],
      idOf: (hit) => hit.id,
      readFacts,
    });

    expect(readFacts).not.toHaveBeenCalled();
    expect(ordered).toBe(pool);
  });

  it('skips the read when the window holds no core or faculty row', async () => {
    const readFacts = factsFor({});
    const pool = [row('lab-1'), row('center-1', 'CENTER')];
    expect(
      await orderServiceCoresBelowResearch(pool, {
        queryTokens: ['x'],
        idOf: (hit) => hit.id,
        readFacts,
      }),
    ).toBe(pool);
    expect(readFacts).not.toHaveBeenCalled();
  });
});

describe('readServiceCoreFacts', () => {
  const setReadyState = (value: number) =>
    Object.defineProperty(mongoose.connection, 'readyState', { value, configurable: true });

  afterEach(() => {
    delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
    mocks.researchEntityFind.mockReset();
  });

  it('reads the title, type and description fields of the requested rows', async () => {
    setReadyState(1);
    const select = vi.fn(() => ({
      lean: async () => [{ _id: 'row-1', entityType: 'CORE_FACILITY' }],
    }));
    mocks.researchEntityFind.mockReturnValue({ select });

    const facts = await readServiceCoreFacts(['row-1']);

    expect(mocks.researchEntityFind).toHaveBeenCalledWith({ _id: { $in: ['row-1'] } });
    expect(select).toHaveBeenCalledWith(
      'entityType name displayName shortDescription fullDescription',
    );
    expect(facts.get('row-1')).toMatchObject({ entityType: 'CORE_FACILITY' });
  });

  it('reads nothing without a connection or without ids', async () => {
    setReadyState(0);
    expect((await readServiceCoreFacts(['row-1'])).size).toBe(0);
    setReadyState(1);
    expect((await readServiceCoreFacts([])).size).toBe(0);
    expect(mocks.researchEntityFind).not.toHaveBeenCalled();
  });

  it('returns no facts when the read fails, so nothing is demoted', async () => {
    setReadyState(1);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.researchEntityFind.mockImplementation(() => {
      throw new Error('read failed');
    });

    expect((await readServiceCoreFacts(['row-1'])).size).toBe(0);
    consoleError.mockRestore();
  });
});
