import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const OFFICE = 'yale-college-fellowships-office';
const READ_AT = new Date('2026-09-20T00:00:00Z');

beforeEach(() => {
  resetInvalidatedScrapeRunCache();
  vi.spyOn(ScrapeRun, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetInvalidatedScrapeRunCache();
});

function projectFellowship(stored: Record<string, unknown>, observations: any[]) {
  vi.spyOn(Observation, 'find').mockReturnValue({
    lean: vi.fn().mockResolvedValue(
      observations.map((observation) => ({
        entityType: 'fellowship',
        entityKey: stored.sourceKey,
        confidence: 0.9,
        sourceName: OFFICE,
        observedAt: READ_AT,
        ...observation,
      })),
    ),
  } as any);
  vi.spyOn(Fellowship, 'findOne').mockReturnValue({
    lean: vi.fn().mockResolvedValue(stored),
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stored) }),
  } as any);
  return materializeEntity('fellowship', { entityKey: String(stored.sourceKey) }, { dryRun: true });
}

describe('the gate-derived program window is not a lane field (#4382)', () => {
  const window = {
    deadline: new Date('2027-01-05T04:59:59.999Z'),
    isAcceptingApplications: true,
    sourceProgramId: '000000000000000000004383',
  };
  const stored = {
    _id: 'fixture-id',
    sourceKey: `${OFFICE}:fixture-research-fund`,
    sourceName: OFFICE,
    title: 'Fixture Research Fund',
    deadline: new Date('2026-07-30T21:00:00.000Z'),
    upcomingDuplicateWindow: window,
  };

  it('refuses an observation that asserts the window', async () => {
    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey },
      { field: 'title', value: stored.title },
      {
        field: 'upcomingDuplicateWindow',
        value: { ...window, deadline: new Date('2030-01-01T00:00:00.000Z') },
      },
    ]);
    expect(result.plannedSet).not.toHaveProperty('upcomingDuplicateWindow');
    expect(result.plannedUnset).not.toHaveProperty('upcomingDuplicateWindow');
  });

  it('never clears it as a value a lane stopped asserting', async () => {
    const result = await projectFellowship(stored, [
      {
        field: 'sourceKey',
        value: stored.sourceKey,
        assertsNoValueFor: ['upcomingDuplicateWindow'],
      },
      { field: 'title', value: stored.title },
      { field: 'upcomingDuplicateWindow', value: window, observedAt: new Date('2026-07-01') },
    ]);
    expect(result.plannedSet).not.toHaveProperty('upcomingDuplicateWindow');
    expect(result.plannedUnset).not.toHaveProperty('upcomingDuplicateWindow');
  });
});
