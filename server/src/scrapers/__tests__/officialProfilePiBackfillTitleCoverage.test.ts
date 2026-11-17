import { afterEach, describe, expect, it, vi } from 'vitest';

import { TITLE_COVERED_KEYS_METRIC, TitleCoverageRecorder } from '../latestFullCoverageRun';
import { OfficialProfilePiBackfillScraper } from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';

const PROFILE_URL = 'https://medicine.yale.edu/profile/tamsin-coverfixture/';
const NETID_KEY = 'netid:tc6197';

const PROFILE_HTML = `
  <html>
    <head><link rel="canonical" href="${PROFILE_URL}" /></head>
    <body>
      <main>
        <h1>Tamsin Coverfixture</h1>
        <div class="field field--name-field-profile-image"><img src="https://ysm-res.cloudinary.com/image/upload/example/tamsin-coverfixture" alt="" /></div>
        <div class="title">Professor of Fixture Surgery</div>
        <a href="mailto:tamsin.coverfixture@yale.edu">tamsin.coverfixture@yale.edu</a>
      </main>
    </body>
  </html>
`;

const PROFILE_TARGET = {
  _id: 'user-coverage',
  netid: 'tc6197',
  email: 'tamsin.coverfixture@yale.edu',
  fname: 'Tamsin',
  lname: 'Coverfixture',
  name: 'Tamsin Coverfixture',
  slug: 'tamsin-coverfixture',
  websiteUrl: PROFILE_URL,
};

const titleRow = (entityKey: string): ObservationInput => ({
  entityType: 'user',
  entityKey,
  field: 'title',
  value: 'Professor of Fixture Surgery',
});

function contextFor(only: string[], emitted: ObservationInput[]): ScraperContext {
  return {
    scrapeRunId: 'run-coverage',
    sourceId: 'source-coverage',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: { dryRun: false, useCache: false, release: false, only },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  };
}

function scraperReading(fetchHtml: () => Promise<string>): OfficialProfilePiBackfillScraper {
  return new OfficialProfilePiBackfillScraper(
    vi.fn(fetchHtml),
    vi.fn(async () => []),
    vi.fn(async () => null),
    vi.fn(async () => [PROFILE_TARGET]),
    vi.fn(async () => []),
    vi.fn(async () => []),
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    vi.fn(async () => new Set<string>()),
    vi.fn(async () => []),
    vi.fn(async () => null),
  );
}

/**
 * No keyed mode of this lane emits a title until #6343, so the lane-level cases add a title
 * row to whatever the lane hands the recorder, which proves where and when it records.
 */
function recordAsIfEachUserBatchStatedATitle(): void {
  const recordEmitted = TitleCoverageRecorder.prototype.recordEmitted;
  vi.spyOn(TitleCoverageRecorder.prototype, 'recordEmitted').mockImplementation(function (
    this: TitleCoverageRecorder,
    observations,
  ) {
    const userKey = observations.find(
      (observation) => observation.entityType === 'user',
    )?.entityKey;
    recordEmitted.call(this, userKey ? [...observations, titleRow(userKey)] : observations);
  });
}

describe('official-profile-pi-backfill records the keys a keyed run covered (#6197)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a keyed visible run's real emitted title key (#6343)", async () => {
    const emitted: ObservationInput[] = [];
    const result = await scraperReading(async () => PROFILE_HTML).run(
      contextFor(['visible-profile-bio-backfill', NETID_KEY], emitted),
    );

    expect(emitted.some((o) => o.entityType === 'user' && o.field === 'title')).toBe(true);
    expect(result.metrics?.[TITLE_COVERED_KEYS_METRIC]).toEqual([NETID_KEY]);
  });

  it('records the emitted title keys of a keyed run', async () => {
    recordAsIfEachUserBatchStatedATitle();
    const result = await scraperReading(async () => PROFILE_HTML).run(
      contextFor(['visible-profile-bio-backfill', NETID_KEY], []),
    );

    expect(result.metrics?.[TITLE_COVERED_KEYS_METRIC]).toEqual([NETID_KEY]);
  });

  it('records nothing for an unkeyed run', async () => {
    recordAsIfEachUserBatchStatedATitle();
    const result = await scraperReading(async () => PROFILE_HTML).run(
      contextFor(['visible-profile-bio-backfill'], []),
    );

    expect(result.metrics?.[TITLE_COVERED_KEYS_METRIC]).toBeUndefined();
  });

  it('records nothing for a key whose page fetch failed', async () => {
    recordAsIfEachUserBatchStatedATitle();
    const result = await scraperReading(async () => {
      throw new Error('HTTP 429');
    }).run(contextFor(['visible-profile-bio-backfill', NETID_KEY], []));

    expect(result.metrics?.[TITLE_COVERED_KEYS_METRIC]).toBeUndefined();
  });
});

describe('TitleCoverageRecorder (#6197)', () => {
  it('covers only user keys it emitted a title for, sorted, keys only', () => {
    const recorder = new TitleCoverageRecorder({ isKeyedRun: true });
    recorder.recordEmitted([
      titleRow('netid:zz6197'),
      { entityType: 'user', entityKey: 'netid:yy6197', field: 'imageUrl', value: 'x' },
      { entityType: 'researchEntity', entityKey: 'lab-fixture', field: 'title', value: 'x' },
      titleRow('netid:aa6197'),
    ]);

    expect(recorder.resultMetrics()).toEqual({
      metrics: { [TITLE_COVERED_KEYS_METRIC]: ['netid:aa6197', 'netid:zz6197'] },
    });
  });

  it('records nothing for an unkeyed run', () => {
    const recorder = new TitleCoverageRecorder({ isKeyedRun: false });
    recorder.recordEmitted([titleRow('netid:aa6197')]);

    expect(recorder.resultMetrics()).toEqual({});
  });
});
