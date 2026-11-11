import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';

const BOTH_SCHEMES = 'http://both.fixture.example.org/lab/';
const TLS_FAILS = 'http://tls.fixture.example.org/lab/';
const HTTPS_GONE = 'http://gone.fixture.example.org/lab/';
const REDIRECTS = 'http://redirects.fixture.example.org/lab/';
const HTTPS_ONLY = 'https://secure.fixture.example.org/lab/';
const HTTP_CITATION = 'http://citation.fixture.example.org/page/';

const httpsOf = (url: string) => url.replace(/^http:/, 'https:');

const verdicts: Record<string, SourceLinkHealth> = {
  [httpsOf(BOTH_SCHEMES)]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
  [httpsOf(TLS_FAILS)]: { healthStatus: 'UNKNOWN', tlsVerificationFailed: true },
  [httpsOf(HTTPS_GONE)]: { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
  [REDIRECTS]: {
    healthStatus: 'HEALTHY',
    httpStatusCode: 200,
    httpsLandingUrl: httpsOf(REDIRECTS),
  },
};

interface StoredEntry {
  url: string;
  healthStatus: string;
  httpsSpellingUrl?: string;
}

const storedHealthOf = async (slug: string): Promise<StoredEntry[]> => {
  const row = (await ResearchEntity.findOne({ slug }).lean()) as {
    sourceLinkHealth?: StoredEntry[];
  } | null;
  return row?.sourceLinkHealth ?? [];
};

describe('source-link-health https spelling of an http website (#5639)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    const row = (slug: string, websiteUrl: string, sourceUrls: string[] = []) => ({
      slug,
      name: `Fixture ${slug}`,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl,
      sourceUrls,
    });
    await ResearchEntity.create([
      row('fixture-both', BOTH_SCHEMES),
      row('fixture-tls', TLS_FAILS),
      row('fixture-gone', HTTPS_GONE),
      row('fixture-redirects', REDIRECTS),
      row('fixture-https-only', HTTPS_ONLY, [HTTP_CITATION]),
    ]);
  });

  const run = async () => {
    const seen: string[] = [];
    await runSourceLinkHealthBackfill({
      dryRun: false,
      paceDelayMs: 0,
      checkLink: async (url: string) => {
        seen.push(url);
        return verdicts[url] ?? { healthStatus: 'HEALTHY', httpStatusCode: 200 };
      },
    });
    return seen;
  };

  it('records a healthy https spelling on the http entry without adding an entry', async () => {
    const seen = await run();
    expect(seen).toContain(httpsOf(BOTH_SCHEMES));
    expect(await storedHealthOf('fixture-both')).toEqual([
      expect.objectContaining({
        url: BOTH_SCHEMES,
        healthStatus: 'HEALTHY',
        httpsSpellingUrl: httpsOf(BOTH_SCHEMES),
      }),
    ]);
  }, 120000);

  it('records nothing when the https spelling fails its certificate or is gone', async () => {
    const seen = await run();
    expect(seen).toEqual(expect.arrayContaining([httpsOf(TLS_FAILS), httpsOf(HTTPS_GONE)]));
    for (const slug of ['fixture-tls', 'fixture-gone']) {
      const entries = await storedHealthOf(slug);
      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toHaveProperty('httpsSpellingUrl');
    }
  }, 120000);

  it('never probes a spelling for an https website, a redirecting website or a citation', async () => {
    const seen = await run();
    expect(seen).not.toContain(httpsOf(REDIRECTS));
    expect(seen).not.toContain(httpsOf(HTTP_CITATION));
    expect(seen).not.toContain(HTTPS_ONLY.replace(/^https:/, 'http:'));
    const httpsOnly = await storedHealthOf('fixture-https-only');
    expect(httpsOnly.map((entry) => entry.url).sort()).toEqual([HTTPS_ONLY, HTTP_CITATION].sort());
    for (const entry of [...httpsOnly, ...(await storedHealthOf('fixture-redirects'))]) {
      expect(entry).not.toHaveProperty('httpsSpellingUrl');
    }
  }, 120000);
});
