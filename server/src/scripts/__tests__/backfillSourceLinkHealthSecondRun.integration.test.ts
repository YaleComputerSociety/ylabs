import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { classifySourceLinkHealth } from '../../services/sourceLinkHealth';
import {
  runSourceLinkHealthBackfill,
  sourceLinkHealthBackfillStdoutSummary,
} from '../backfillSourceLinkHealth';

const LIVE_URL = 'https://lab.example.edu/';
const CHECKED = new Date(Date.now() - 2 * 86_400_000);

interface StoredEntry {
  url: string;
  healthStatus: string;
  checkedAt?: Date;
  pendingConnectionFailureAt?: Date;
  pendingConnectionFailureProbedAt?: Date;
  confirmingConnectionFailureAt?: Date;
}

const storedEntry = async (): Promise<StoredEntry | undefined> => {
  const row = (await ResearchEntity.findOne({ slug: 'dept-example-lab' }).lean()) as {
    sourceLinkHealth?: StoredEntry[];
  } | null;
  return row?.sourceLinkHealth?.[0];
};

const refusingCheckLink = async (url: string) =>
  classifySourceLinkHealth({ errorCode: 'ECONNREFUSED', requestedUrl: url });

describe('source-link-health holds a refused connection for a second run (#6116)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    await ResearchEntity.create({
      slug: 'dept-example-lab',
      name: 'Example Lab',
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: LIVE_URL,
      sourceLinkHealth: [
        { url: LIVE_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: CHECKED },
      ],
    });
  });

  it('holds a refused connection through a resumed run and retires it six hours on', async () => {
    const first = await runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: refusingCheckLink,
      paceDelayMs: 0,
    });
    expect(first.heldConnectionFailures).toBe(1);
    const printed = JSON.stringify(sourceLinkHealthBackfillStdoutSummary(first));
    expect(sourceLinkHealthBackfillStdoutSummary(first).heldConnectionFailures).toBe(1);
    expect(printed).not.toContain(LIVE_URL);
    expect(printed).not.toContain('dept-example-lab');
    const held = await storedEntry();
    expect(held?.healthStatus).toBe('HEALTHY');
    expect(held?.checkedAt?.getTime()).toBe(CHECKED.getTime());
    expect(held?.pendingConnectionFailureAt).toBeInstanceOf(Date);

    const resumed = await runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: refusingCheckLink,
      paceDelayMs: 0,
    });
    expect(resumed.heldConnectionFailures).toBe(1);
    expect((await storedEntry())?.healthStatus).toBe('HEALTHY');

    const firstFailureAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await ResearchEntity.updateOne(
      { slug: 'dept-example-lab' },
      {
        $set: {
          'sourceLinkHealth.0.pendingConnectionFailureAt': firstFailureAt,
          'sourceLinkHealth.0.pendingConnectionFailureProbedAt': firstFailureAt,
        },
      },
    );

    const second = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink: refusingCheckLink,
      paceDelayMs: 0,
    });
    expect(second.heldConnectionFailures).toBe(0);
    expect(second.verdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': 1 });
    const retired = await storedEntry();
    expect(retired?.healthStatus).toBe('UNAVAILABLE');
    expect(retired?.pendingConnectionFailureAt?.getTime()).toBe(firstFailureAt.getTime());
    expect(retired?.pendingConnectionFailureProbedAt?.getTime()).toBe(firstFailureAt.getTime());
    expect(retired?.confirmingConnectionFailureAt).toBeInstanceOf(Date);
  }, 120000);

  it('measures the six-hour gap from when a shared link was probed, not when a later row is written', async () => {
    const HOUR = 60 * 60 * 1000;
    const probeInstant = new Date();
    vi.useFakeTimers({ toFake: ['Date'], now: probeInstant });
    const earlierRunStart = new Date(probeInstant.getTime() - 7 * HOUR);
    const earlierProbe = new Date(probeInstant.getTime() - 5 * HOUR);
    const pendingEntry = {
      url: LIVE_URL,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      checkedAt: CHECKED,
      pendingConnectionFailureAt: earlierRunStart,
      pendingConnectionFailureProbedAt: earlierProbe,
    };
    const laterPageUrl = 'https://center.example.org/about/';
    await ResearchEntity.updateOne(
      { slug: 'dept-example-lab' },
      { $set: { sourceLinkHealth: [pendingEntry] } },
    );
    await ResearchEntity.create({
      slug: 'dept-example-center',
      name: 'Example Center',
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: LIVE_URL,
      sourceUrls: [laterPageUrl],
      sourceLinkHealth: [pendingEntry],
    });

    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      pageSize: 1,
      checkLink: async (url: string) => {
        if (url === laterPageUrl) {
          vi.setSystemTime(new Date(probeInstant.getTime() + 2 * HOUR));
          return classifySourceLinkHealth({ status: 200, requestedUrl: url, finalUrl: url });
        }
        return refusingCheckLink(url);
      },
      paceDelayMs: 0,
    });

    expect(result.heldConnectionFailures).toBe(2);
    expect(result.verdictTransitions).toEqual({ 'NONE->HEALTHY': 1 });
    const later = (await ResearchEntity.findOne({ slug: 'dept-example-center' }).lean()) as {
      sourceLinkHealth?: StoredEntry[];
    } | null;
    const laterEntry = later?.sourceLinkHealth?.find((entry) => entry.url === LIVE_URL);
    expect(laterEntry?.healthStatus).toBe('HEALTHY');
    expect(laterEntry?.pendingConnectionFailureProbedAt?.getTime()).toBe(earlierProbe.getTime());
  }, 120000);

  it('clears the stored pending failure when the next run reaches the host', async () => {
    await runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: refusingCheckLink,
      paceDelayMs: 0,
    });
    expect((await storedEntry())?.pendingConnectionFailureAt).toBeInstanceOf(Date);
    await runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: async (url: string) =>
        classifySourceLinkHealth({ status: 200, requestedUrl: url, finalUrl: url }),
      paceDelayMs: 0,
    });
    const cleared = await storedEntry();
    expect(cleared?.healthStatus).toBe('HEALTHY');
    expect(cleared?.pendingConnectionFailureAt).toBeUndefined();
  }, 120000);

  it('never probes or holds a link on an excluded host', async () => {
    const probed: string[] = [];
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      excludeHosts: ['lab.example.edu'],
      checkLink: async (url: string) => {
        probed.push(url);
        return refusingCheckLink(url);
      },
      paceDelayMs: 0,
    });
    expect(probed).toEqual([]);
    expect(result.heldConnectionFailures).toBe(0);
    const carried = await storedEntry();
    expect(carried?.healthStatus).toBe('HEALTHY');
    expect(carried?.checkedAt?.getTime()).toBe(CHECKED.getTime());
    expect(carried?.pendingConnectionFailureAt).toBeUndefined();
  }, 120000);

  it('keeps a stored pending failure when its host is later excluded', async () => {
    await runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: refusingCheckLink,
      paceDelayMs: 0,
    });
    const firstFailureAt = (await storedEntry())?.pendingConnectionFailureAt;
    expect(firstFailureAt).toBeInstanceOf(Date);
    await ResearchEntity.updateOne(
      { slug: 'dept-example-lab' },
      { $set: { sourceUrls: ['https://center.example.org/about/'] } },
    );
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      excludeHosts: ['lab.example.edu'],
      checkLink: async (url: string) =>
        classifySourceLinkHealth({ status: 200, requestedUrl: url, finalUrl: url }),
      paceDelayMs: 0,
    });
    expect(result.updated).toBe(1);
    expect(result.heldConnectionFailures).toBe(0);
    const carried = await storedEntry();
    expect(carried?.healthStatus).toBe('HEALTHY');
    expect(carried?.pendingConnectionFailureAt?.getTime()).toBe(firstFailureAt?.getTime());
  }, 120000);
});
