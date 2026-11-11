import { describe, expect, it } from 'vitest';

import {
  SERVICE_CORE_BEHIND_RESEARCH_ROWS,
  SERVICE_CORE_DEMOTION_WINDOW,
  demoteServiceCoresBelowResearch,
  orderServiceCoresBelowResearch,
  queryNamesTheRow,
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
  const order = (
    pool: Array<{ id: string; entityType: string }>,
    queryTokens: string[],
    facts: Record<string, ServiceCoreFacts>,
  ) =>
    orderServiceCoresBelowResearch(pool, {
      queryTokens,
      idOf: (hit) => hit.id,
      factsById: new Map(Object.entries(facts)),
    });

  it('demotes the cores of the window by their stored facts', () => {
    const pool = [
      row('core-a', 'CORE_FACILITY'),
      row('lab-1'),
      row('p1', 'FACULTY_RESEARCH_AREA'),
      row('center-1', 'CENTER'),
    ];
    const ordered = order(pool, ['chemistry'], {
      'core-a': { entityType: 'CORE_FACILITY', name: 'Example Analytical Core' },
      p1: {
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Example Person',
        shortDescription: 'Studies chemistry.',
      },
      'lab-1': {
        entityType: 'LAB',
        shortDescription: 'Provides imaging services to investigators.',
      },
    });
    expect(ids(ordered)).toEqual(['lab-1', 'p1', 'center-1', 'core-a']);
  });

  it('keeps a core the query names, and a core with no stored facts', () => {
    const pool = [row('core-a', 'CORE_FACILITY'), row('core-b', 'CORE_FACILITY'), row('lab-1')];
    const ordered = order(pool, ['example', 'analytical'], {
      'core-a': { entityType: 'CORE_FACILITY', name: 'Example Analytical Core' },
    });
    expect(ids(ordered)).toEqual(ids(pool));
  });

  it('leaves a core past the window where it is', () => {
    const research = Array.from({ length: SERVICE_CORE_DEMOTION_WINDOW }, (_, index) =>
      row(`r${index}`),
    );
    const pool = [...research, row('core-late', 'CORE_FACILITY'), row('r-last')];
    expect(
      order(pool, ['chemistry'], {
        'core-late': { entityType: 'CORE_FACILITY', name: 'Late Core' },
      }),
    ).toBe(pool);
  });

  it('serves the pool unchanged when the window holds no core or faculty row', () => {
    const pool = [row('lab-1'), row('center-1', 'CENTER')];
    expect(order(pool, ['x'], {})).toBe(pool);
  });
});
