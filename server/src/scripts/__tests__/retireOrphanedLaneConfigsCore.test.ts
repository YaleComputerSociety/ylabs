import { describe, expect, it } from 'vitest';
import {
  fieldsCreditedToRetired,
  judgeLaneConfig,
  keyNamespaceForEntityKey,
  laneConfigDefinitionPattern,
  parseRequestedLaneConfigs,
  planOrphanedLaneConfigRetirement,
  runOnlySelection,
  servedFieldChanges,
  type OrphanLaneDefinition,
  type StoredLaneObservation,
  type StoredLaneRun,
} from '../retireOrphanedLaneConfigsCore';

const ROSTER: OrphanLaneDefinition = {
  sourceName: 'dept-faculty-roster',
  currentConfigIds: ['chem', 'forestry', 'paused-lane'],
  currentKeyNamespaces: ['chem', 'forestry', 'paused-lane'],
  keyNamespaceOf: (configId) => configId,
};

const DIRECTORY: OrphanLaneDefinition = {
  sourceName: 'yale-research-official',
  currentConfigIds: ['centers-institutes', 'core-facilities'],
  currentKeyNamespaces: [],
};

const LANES = [ROSTER, DIRECTORY];

const observation = (
  id: string,
  entityKey: string,
  overrides: Partial<StoredLaneObservation> = {},
): StoredLaneObservation => ({
  id,
  sourceName: 'dept-faculty-roster',
  entityType:
    entityKey.startsWith('dept:') || entityKey.startsWith('netid:') ? 'user' : 'researchEntity',
  entityKey,
  field: 'websiteUrl',
  scrapeRunId: 'run-unlanded',
  ...overrides,
});

const RUNS: StoredLaneRun[] = [
  { id: 'run-unlanded', only: ['gone-lane'] },
  { id: 'run-landed', codeSha: 'a'.repeat(40), only: [] },
  { id: 'run-off-every-ref', codeSha: 'b'.repeat(40), only: [] },
  { id: 'run-full', only: [] },
  { id: 'run-forestry-gone', only: ['forestry-gone'] },
  { id: 'run-paused', only: ['paused-lane'] },
  { id: 'run-directory-gone', only: ['cores'] },
  { id: 'run-mixed', only: ['cores', 'core-facilities'] },
];

describe('parseRequestedLaneConfigs', () => {
  it('reads lane:config pairs, lowercases ids and drops repeats', () => {
    expect(
      parseRequestedLaneConfigs('dept-faculty-roster:Gone-Lane, dept-faculty-roster:gone-lane'),
    ).toEqual([{ sourceName: 'dept-faculty-roster', configId: 'gone-lane' }]);
  });

  it('refuses an entry that does not name a lane and a plain id', () => {
    expect(() => parseRequestedLaneConfigs('gone-lane')).toThrow(/not <lane>:<config-id>/);
    expect(() => parseRequestedLaneConfigs('dept-faculty-roster:gone lane')).toThrow();
    expect(() => parseRequestedLaneConfigs(' , ')).toThrow(/at least one/);
  });
});

describe('judgeLaneConfig', () => {
  it('keeps a config the code still defines even when nothing has run it recently', () => {
    expect(
      judgeLaneConfig({
        config: { sourceName: 'dept-faculty-roster', configId: 'paused-lane' },
        lanes: LANES,
        refPresence: [],
      }),
    ).toEqual({ status: 'present-in-code' });
  });

  it('keeps a config that only an unmerged branch defines', () => {
    expect(
      judgeLaneConfig({
        config: { sourceName: 'dept-faculty-roster', configId: 'pending-lane' },
        lanes: LANES,
        refPresence: [
          {
            sourceName: 'dept-faculty-roster',
            configId: 'pending-lane',
            refs: ['repo#refs/remotes/origin/feat/pending-lane'],
          },
        ],
      }),
    ).toEqual({ status: 'present-on-ref', refs: ['repo#refs/remotes/origin/feat/pending-lane'] });
  });

  it('calls a config orphaned only when neither the code nor any ref defines it', () => {
    expect(
      judgeLaneConfig({
        config: { sourceName: 'dept-faculty-roster', configId: 'gone-lane' },
        lanes: LANES,
        refPresence: [{ sourceName: 'dept-faculty-roster', configId: 'gone-lane', refs: [] }],
      }),
    ).toEqual({ status: 'orphaned' });
    expect(
      judgeLaneConfig({
        config: { sourceName: 'unknown-lane', configId: 'gone-lane' },
        lanes: LANES,
        refPresence: [],
      }),
    ).toEqual({ status: 'unknown-lane' });
  });
});

describe('keyNamespaceForEntityKey', () => {
  it('gives a key to the longest namespace that prefixes it', () => {
    const namespaces = ['forestry', 'forestry-gone'];
    expect(
      keyNamespaceForEntityKey('researchEntity', 'dept-forestry-gone-pat-lee', namespaces),
    ).toBe('forestry-gone');
    expect(keyNamespaceForEntityKey('researchEntity', 'dept-forestry-pat-lee', namespaces)).toBe(
      'forestry',
    );
    expect(keyNamespaceForEntityKey('user', 'dept:forestry-gone:pat-lee', namespaces)).toBe(
      'forestry-gone',
    );
    expect(keyNamespaceForEntityKey('user', 'netid:pl1', namespaces)).toBeUndefined();
  });
});

describe('laneConfigDefinitionPattern', () => {
  it('matches a config definition in either quote style and nothing that merely mentions the id', () => {
    const pattern = laneConfigDefinitionPattern('gone-lane');
    expect(pattern.test("    deptKey: 'gone-lane',")).toBe(true);
    expect(pattern.test('  key: "gone-lane",')).toBe(true);
    expect(pattern.test("  ['gone-lane', 'engineering'],")).toBe(false);
    expect(pattern.test("  deptKey: 'gone-lane-two',")).toBe(false);
  });
});

describe('planOrphanedLaneConfigRetirement', () => {
  const plan = (
    requested: Array<{ sourceName: string; configId: string }>,
    observations: StoredLaneObservation[],
  ) =>
    planOrphanedLaneConfigRetirement({
      requested,
      lanes: LANES,
      refPresence: [
        {
          sourceName: 'dept-faculty-roster',
          configId: 'pending-lane',
          refs: ['repo#refs/heads/feat/pending'],
        },
      ],
      observations,
      runs: RUNS,
      codeShasOnRef: new Set(['a'.repeat(40)]),
    });

  it('attributes by key namespace and by a run that selected only orphaned configs', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'gone-lane' }],
      [
        observation('o1', 'dept-gone-lane-pat-lee'),
        observation('o2', 'dept:gone-lane:pat-lee'),
        observation('o3', 'netid:pl1'),
        observation('o4', 'dept-chem-pat-lee'),
      ],
    );
    expect(result.observationIdsToRetire).toEqual(['o1', 'o2', 'o3']);
    expect(result.countsByConfig['dept-faculty-roster:gone-lane']).toMatchObject({
      observations: 3,
      byBasis: { 'key-namespace': 2, 'run-only': 1 },
    });
  });

  it('retracts nothing for a config present in code but suspended or unread', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'paused-lane' }],
      [
        observation('p1', 'dept-paused-lane-pat-lee', { scrapeRunId: 'run-paused' }),
        observation('p2', 'netid:pl1', { scrapeRunId: 'run-paused' }),
      ],
    );
    expect(result.verdicts[0].verdict).toEqual({ status: 'present-in-code' });
    expect(result.observationIdsToRetire).toEqual([]);
  });

  it('retracts nothing for a config that exists only on an unmerged branch', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'pending-lane' }],
      [
        observation('u1', 'dept:pending-lane:pat-lee'),
        observation('u2', 'dept-pending-lane-pat-lee'),
      ],
    );
    expect(result.verdicts[0].verdict.status).toBe('present-on-ref');
    expect(result.observationIdsToRetire).toEqual([]);
  });

  it('holds an observation whose run recorded code a ref holds, or that has no run', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'gone-lane' }],
      [
        observation('h1', 'dept-gone-lane-pat-lee', { scrapeRunId: 'run-landed' }),
        observation('h2', 'dept-gone-lane-pat-lee', { scrapeRunId: undefined }),
      ],
    );
    expect(result.observationIdsToRetire).toEqual([]);
    expect(result.held.map((entry) => entry.reason).sort()).toEqual(['no-run', 'run-code-on-ref']);
  });

  it('retires an observation whose run recorded a commit no scanned ref reaches', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'gone-lane' }],
      [observation('r1', 'dept-gone-lane-pat-lee', { scrapeRunId: 'run-off-every-ref' })],
    );
    expect(result.observationIdsToRetire).toEqual(['r1']);
    expect(result.held).toEqual([]);
  });

  it('needs the run selection for a research key a current namespace also prefixes', () => {
    const result = plan(
      [{ sourceName: 'dept-faculty-roster', configId: 'forestry-gone' }],
      [
        observation('a1', 'dept-forestry-gone-pat-lee', { scrapeRunId: 'run-full' }),
        observation('a2', 'dept-forestry-gone-pat-lee', { scrapeRunId: 'run-forestry-gone' }),
        observation('a3', 'dept:forestry-gone:pat-lee', { scrapeRunId: 'run-full' }),
      ],
    );
    expect(result.verdicts[0].verdict).toEqual({ status: 'orphaned' });
    expect(
      result.attributed.map((entry) => `${entry.observation.id}:${entry.basis}`).sort(),
    ).toEqual(['a2:run-only', 'a3:key-namespace']);
  });

  it('attributes a directory lane only through a run whose every selected config is orphaned', () => {
    const directory = (id: string, scrapeRunId: string) =>
      observation(id, 'core-alpha', { sourceName: 'yale-research-official', scrapeRunId });
    const result = plan(
      [{ sourceName: 'yale-research-official', configId: 'cores' }],
      [
        directory('d1', 'run-directory-gone'),
        directory('d2', 'run-mixed'),
        directory('d3', 'run-landed'),
      ],
    );
    expect(result.observationIdsToRetire).toEqual(['d1']);
  });

  it('plans the same retirement on a second read of the same evidence', () => {
    const evidence = [observation('o1', 'dept-gone-lane-pat-lee'), observation('o3', 'netid:pl1')];
    const requested = [{ sourceName: 'dept-faculty-roster', configId: 'gone-lane' }];
    expect(plan(requested, evidence)).toEqual(plan(requested, evidence));
  });
});

describe('runOnlySelection', () => {
  it('reads an array or a comma list, lowercased and unique', () => {
    expect(runOnlySelection({ only: ['Cores', 'cores '] })).toEqual(['cores']);
    expect(runOnlySelection({ only: 'a,b' })).toEqual(['a', 'b']);
    expect(runOnlySelection({})).toEqual([]);
    expect(runOnlySelection(null)).toEqual([]);
  });
});

describe('servedFieldChanges', () => {
  it('reports a field only when the projections with and without the retired evidence differ', () => {
    const changes = servedFieldChanges({
      stored: { websiteUrl: 'https://old.example.edu', name: 'Alpha Lab', departments: ['Chem'] },
      withOrphans: { set: { websiteUrl: 'https://old.example.edu', lastObservedAt: 1 }, unset: {} },
      withoutOrphans: {
        set: { websiteUrl: 'https://lab.example.edu', lastObservedAt: 2 },
        unset: { departments: '' },
      },
      creditedFields: new Set(['websiteUrl']),
    });
    expect(changes).toEqual([
      expect.objectContaining({
        field: 'departments',
        becomesEmpty: true,
        creditedToRetired: false,
      }),
      expect.objectContaining({
        field: 'websiteUrl',
        projectedWithOrphans: 'https://old.example.edu',
        projectedWithoutOrphans: 'https://lab.example.edu',
        creditedToRetired: true,
        becomesEmpty: false,
      }),
    ]);
  });

  it('ignores drift both projections share', () => {
    expect(
      servedFieldChanges({
        stored: { name: 'Alpha Lab' },
        withOrphans: { set: { name: 'Alpha Laboratory' }, unset: {} },
        withoutOrphans: { set: { name: 'Alpha Laboratory' }, unset: {} },
        creditedFields: new Set(),
      }),
    ).toEqual([]);
  });
});

describe('fieldsCreditedToRetired', () => {
  it('names fields whose provenance points at a retired observation', () => {
    expect([
      ...fieldsCreditedToRetired(
        { websiteUrl: { observationId: 'o1' }, name: { observationId: 'o9' } },
        new Set(['o1']),
      ),
    ]).toEqual(['websiteUrl']);
    expect([
      ...fieldsCreditedToRetired(new Map([['name', { observationId: 'o1' }]]), new Set(['o1'])),
    ]).toEqual(['name']);
  });
});
