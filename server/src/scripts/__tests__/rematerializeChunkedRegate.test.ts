import { describe, expect, it } from 'vitest';
import {
  collectRematerializeEntityReports,
  createChunkedRegater,
  selectRematerializeRegateEntityIds,
  type RematerializeEntityReport,
} from '../rematerializeResearchEntitiesCore';

const changedReport = (slug: string): RematerializeEntityReport => ({
  slug,
  found: true,
  entityId: `id-${slug}`,
  changes: [{ field: 'researchAreas', before: ['old topic'], after: ['new topic'] }],
});

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createChunkedRegater (#6370)', () => {
  it('re-gates a written chunk before the run dies, so no written row keeps a stale tier', async () => {
    const regated: string[][] = [];
    const regater = createChunkedRegater(async (ids: string[]) => {
      regated.push(ids);
      return ids.length;
    }, 2);
    let reachedThirdRow = false;
    const neverReturns = new Promise<RematerializeEntityReport>(() => {});

    void collectRematerializeEntityReports(
      ['first-row', 'second-row', 'third-row'],
      async (slug) => {
        if (slug === 'third-row') {
          reachedThirdRow = true;
          return neverReturns;
        }
        return changedReport(slug);
      },
      (report) => regater.add(selectRematerializeRegateEntityIds([report])),
    );
    await flushMicrotasks();

    expect(reachedThirdRow).toBe(true);
    expect(regated).toEqual([['id-first-row', 'id-second-row']]);
  });

  it('flushes the partial last chunk on finish and re-gates each id once', async () => {
    const regated: string[][] = [];
    const regater = createChunkedRegater(async (ids: string[]) => {
      regated.push(ids);
      return ids.length;
    }, 2);

    await regater.add(['a', 'b', 'a']);
    await regater.add(['c']);
    const { summaries, error } = await regater.finish();

    expect(regated).toEqual([['a', 'b'], ['c']]);
    expect(summaries).toEqual([2, 1]);
    expect(error).toBeUndefined();
  });

  it('re-gates a row written again after its chunk already flushed', async () => {
    const regated: string[][] = [];
    const regater = createChunkedRegater(async (ids: string[]) => {
      regated.push(ids);
      return ids.length;
    }, 1);

    await regater.add(['survivor']);
    await regater.add(['survivor']);
    await regater.finish();

    expect(regated).toEqual([['survivor'], ['survivor']]);
  });

  it('records the first re-gate failure and stops re-gating instead of attributing it to a row', async () => {
    let calls = 0;
    const regater = createChunkedRegater(async () => {
      calls += 1;
      throw new Error('gate unavailable');
    }, 1);

    await regater.add(['a']);
    await regater.add(['b']);
    const { summaries, error } = await regater.finish();

    expect(calls).toBe(1);
    expect(summaries).toEqual([]);
    expect(error).toContain('gate unavailable');
    expect(error).toContain('2 written row(s) left un-regated');
  });

  it('keeps per-row failures out of the re-gate', async () => {
    const regated: string[][] = [];
    const regater = createChunkedRegater(async (ids: string[]) => {
      regated.push(ids);
      return ids.length;
    }, 10);

    const reports = await collectRematerializeEntityReports(
      ['ok-row', 'broken-row'],
      async (slug) => {
        if (slug === 'broken-row') throw new Error('materialize failed');
        return changedReport(slug);
      },
      (report) => regater.add(selectRematerializeRegateEntityIds([report])),
    );
    await regater.finish();

    expect(reports.map((report) => Boolean(report.error))).toEqual([false, true]);
    expect(regated).toEqual([['id-ok-row']]);
  });
});
