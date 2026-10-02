import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (..._args: unknown[]) => {}),
  syncEntity: vi.fn(async () => true),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, ...meiliMocks };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { dedupeAccountlessResearcherShells } from '../../scripts/dedupeAccountlessResearcherShells';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
  type HtmlFetcher,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const HOME_URL = 'https://fixture-center.example.edu/';
const ROSTER_URL = 'https://fixture-center.example.edu/people';
const CENTER_SLUG = 'center-fixture-identity';
const LONG_AGO = new Date('2026-01-15T00:00:00Z');

const centerProfileUrl = (first: string) =>
  `https://fixture-center.yale.edu/center/profile/${first.toLowerCase()}-synthetic/`;
const officialProfileUrl = (first: string) =>
  `https://fixture-dept.yale.edu/profile/${first.toLowerCase()}-synthetic/`;

const member = (first: string, role: CenterMember['role'] = 'core-faculty'): CenterMember => ({
  name: `${first} Synthetic`,
  role,
  profileUrl: centerProfileUrl(first),
});

const ROSTER = ['Avery', 'Blair', 'Casey', 'Devon'].map((first) => member(first));

const config: CenterConfig = {
  centerKey: 'fixture-identity',
  centerName: 'Fixture Identity Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: HOME_URL,
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
};

type ProfilePages = Record<string, string>;

const fetcherFor =
  (roster: CenterMember[], profiles: ProfilePages): HtmlFetcher =>
  async (url: string) => {
    if (url.startsWith(ROSTER_URL)) return JSON.stringify(roster);
    const html = profiles[url];
    if (html === undefined) {
      throw Object.assign(new Error('Request failed with status code 404'), {
        response: { status: 404 },
      });
    }
    return html;
  };

const profilePage = (
  options: { canonical?: string; email?: string; netid?: string; links?: string[] } = {},
) => {
  const head = options.canonical ? `<link rel="canonical" href="${options.canonical}">` : '';
  const jsonLd = options.netid
    ? `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Person',
        identifier: { propertyID: 'NetID', value: options.netid },
      })}</script>`
    : '';
  const mail = options.email ? `<a href="mailto:${options.email}">Email</a>` : '';
  const links = (options.links ?? []).map((href) => `<a href="${href}">Related</a>`).join('');
  return `<html><head>${head}${jsonLd}</head><body><h1>Profile</h1>${mail}${links}</body></html>`;
};

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(profiles: ProfilePages, roster: CenterMember[] = ROSTER): Promise<void> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const fetcher = fetcherFor(roster, profiles);
  await new CentersInstitutesScraper([config], null, fetcher, (url) =>
    fetcher(url, false, SOURCE_NAME),
  ).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

const centerId = async () => {
  const entity = (await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any;
  return entity?._id;
};

const accountHolder = async (
  first: string,
  options: { officialUrl?: string; email?: string; netid?: string; displayName?: string } = {},
) => {
  const netid = options.netid ?? `${first.toLowerCase()}9`;
  const account = await Account.create({
    netid,
    email: options.email ?? `${netid}@fixture.example.edu`,
    status: 'UNKNOWN',
    archived: false,
  });
  const researcher = await Researcher.create({
    displayName: options.displayName ?? `${first} Synthetic`,
    accountId: account._id,
    profileLinks: options.officialUrl
      ? [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: options.officialUrl,
            verifiedAt: LONG_AGO,
          },
        ]
      : [],
    archived: false,
  });
  return researcher._id as mongoose.Types.ObjectId;
};

const nameOnlyShell = async (first: string) =>
  (
    await Researcher.create({
      displayName: `${first} Synthetic`,
      profileLinks: [],
      archived: false,
    })
  )._id as mongoose.Types.ObjectId;

const edgeOn = async (
  personId: mongoose.Types.ObjectId,
  role: string,
  extra: Record<string, unknown> = {},
) =>
  (
    await RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
      role,
      state: 'UNKNOWN',
      confidence: 0.5,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      startedAt: LONG_AGO,
      ...extra,
    })
  )._id as mongoose.Types.ObjectId;

const edgeById = async (id: unknown) => (await RoleAssignment.findById(id).lean()) as any;

const researcherById = async (id: unknown) => (await Researcher.findById(id).lean()) as any;

const liveEdgesOf = async (personId: mongoose.Types.ObjectId) =>
  ((await RoleAssignment.find({ personId, 'target.id': await centerId() }).lean()) as any[]).filter(
    (row) => row.archived !== true && row.state !== 'HISTORICAL',
  );

const researchersNamed = async (first: string) =>
  Researcher.countDocuments({ displayName: `${first} Synthetic`, archived: { $ne: true } });

const servedNames = async (): Promise<string[]> => {
  await ResearchEntity.updateOne(
    { slug: CENTER_SLUG },
    {
      $set: {
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'The center convenes faculty who study synthetic fixtures and the methods used to test them.',
      },
    },
  );
  const detail = await getResearchGroupDetail(CENTER_SLUG);
  return (detail?.members ?? [])
    .map((entry: any) => String(entry.user?.displayName || ''))
    .filter(Boolean);
};

const seedCenter = () => runLane({}, []);

describe(
  'centers-institutes-index resolves a center-hosted profile only through identity evidence (#3802)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet?.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      for (const name of [
        'observations',
        'research_entities',
        'research_entity_relationships',
        'researchers',
        'role_assignments',
        'scrape_runs',
        'accounts',
      ]) {
        await db.collection(name).deleteMany({});
      }
      await seedCenter();
    });

    it('joins the listing to the account holder through the official profile its page links', async () => {
      const avery = await accountHolder('Avery', { officialUrl: officialProfileUrl('Avery') });
      const stale = await edgeOn(avery, 'CORE_FACULTY');

      await runLane({
        [centerProfileUrl('Avery')]: profilePage({ canonical: officialProfileUrl('Avery') }),
      });

      expect(await researchersNamed('Avery')).toBe(1);
      const edges = await liveEdgesOf(avery);
      expect(edges).toHaveLength(1);
      expect(String(edges[0]._id)).toBe(String(stale));
      expect(edges[0].rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        identityBasis: 'identity-evidence',
        membershipKey: `official-profile:${centerProfileUrl('Avery')}|core-faculty`,
      });
      const served = await servedNames();
      expect(served.filter((name) => name === 'Avery Synthetic')).toHaveLength(1);
    });

    it('keeps resolving the listing after its page gains a link between reads', async () => {
      const avery = await accountHolder('Avery', { officialUrl: officialProfileUrl('Avery') });
      const stale = await edgeOn(avery, 'CORE_FACULTY');

      await runLane({
        [centerProfileUrl('Avery')]: profilePage({ canonical: officialProfileUrl('Avery') }),
      });
      const firstObservedAt = (await edgeById(stale))?.rosterProvenance?.observedAt;

      await runLane({
        [centerProfileUrl('Avery')]: profilePage({
          canonical: officialProfileUrl('Avery'),
          links: [officialProfileUrl('Blair')],
        }),
      });

      expect(await researchersNamed('Avery')).toBe(1);
      const edges = await liveEdgesOf(avery);
      expect(edges.map((row) => String(row._id))).toEqual([String(stale)]);
      expect(edges[0].rosterProvenance?.identityBasis).toBe('identity-evidence');
      expect(new Date(edges[0].rosterProvenance.observedAt).getTime()).toBeGreaterThan(
        new Date(firstObservedAt).getTime(),
      );
      expect(
        await Observation.countDocuments({
          field: 'profileIdentityEvidence',
          superseded: { $ne: true },
        }),
      ).toBe(1);
    });

    it("joins the listing through the member's own Yale email", async () => {
      const blair = await accountHolder('Blair', { email: 'blair.synthetic2@yale.edu' });

      await runLane({
        [centerProfileUrl('Blair')]: profilePage({ email: 'blair.synthetic2@yale.edu' }),
      });

      expect(await researchersNamed('Blair')).toBe(1);
      expect((await liveEdgesOf(blair)).map((row) => row.rosterProvenance?.identityBasis)).toEqual([
        'identity-evidence',
      ]);
    });

    it('joins the listing through a netid the page labels as one', async () => {
      const casey = await accountHolder('Casey', { netid: 'cs42' });

      await runLane({ [centerProfileUrl('Casey')]: profilePage({ netid: 'cs42' }) });

      expect(await researchersNamed('Casey')).toBe(1);
      expect(await liveEdgesOf(casey)).toHaveLength(1);
    });

    it('mints no second person when only the name matches an account holder', async () => {
      const devon = await accountHolder('Devon');
      const stale = await edgeOn(devon, 'CORE_FACULTY');

      await runLane({ [centerProfileUrl('Devon')]: profilePage() });
      await runLane({});

      expect(await researchersNamed('Devon')).toBe(1);
      const edges = await liveEdgesOf(devon);
      expect(edges.map((row) => String(row._id))).toEqual([String(stale)]);
      expect(edges[0].rosterProvenance?.sourceName).toBeUndefined();
      const served = await servedNames();
      expect(served.filter((name) => name === 'Devon Synthetic')).toHaveLength(1);
    });

    it('does not join a namesake the evidence does not reach, nor a person it names under another name', async () => {
      const avery = await accountHolder('Avery');
      const averyEdge = await edgeOn(avery, 'CORE_FACULTY');
      const otherPerson = await accountHolder('Emery', {
        officialUrl: officialProfileUrl('Emery'),
      });

      await runLane({
        [centerProfileUrl('Avery')]: profilePage({ canonical: officialProfileUrl('Emery') }),
      });

      expect(await researchersNamed('Avery')).toBe(1);
      expect((await edgeById(averyEdge))?.rosterProvenance).toBeUndefined();
      expect(await liveEdgesOf(otherPerson)).toHaveLength(0);
    });

    it('resolves to nobody when the evidence reaches two agreeing people', async () => {
      await accountHolder('Blair', {
        email: 'blair.synthetic2@yale.edu',
        displayName: 'Blair Synthetic',
      });
      await accountHolder('Blair', {
        netid: 'bs77',
        officialUrl: officialProfileUrl('Blair'),
        displayName: 'Blair Q. Synthetic',
      });

      await runLane(
        {
          [centerProfileUrl('Blair')]: profilePage({
            canonical: officialProfileUrl('Blair'),
            email: 'blair.synthetic2@yale.edu',
          }),
        },
        [member('Blair')],
      );

      expect(await RoleAssignment.countDocuments({ 'target.id': await centerId() })).toBe(0);
      expect(await researchersNamed('Blair')).toBe(1);
    });

    it('still records a listing no identified researcher shares a name with', async () => {
      await runLane({ [centerProfileUrl('Casey')]: profilePage() });

      expect(await researchersNamed('Casey')).toBe(1);
      const shell = (await Researcher.findOne({ displayName: 'Casey Synthetic' }).lean()) as any;
      expect(shell.accountId).toBeUndefined();
      expect(await liveEdgesOf(shell._id)).toHaveLength(1);
    });

    it('adopts the holder edge of an unlisted role and retires it after two complete reads', async () => {
      const avery = await accountHolder('Avery', { officialUrl: officialProfileUrl('Avery') });
      const staleLead = await edgeOn(avery, 'DIRECTOR');
      const pages = {
        [centerProfileUrl('Avery')]: profilePage({ canonical: officialProfileUrl('Avery') }),
      };

      await runLane(pages);
      expect((await edgeById(staleLead))?.rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: `official-profile:${centerProfileUrl('Avery')}|director`,
      });

      await runLane(pages);
      expect((await edgeById(staleLead))?.state).toBe('HISTORICAL');
      expect((await liveEdgesOf(avery)).map((row) => row.role)).toEqual(['CORE_FACULTY']);
    });

    it('lets the accountless-shell dedupe fold an existing twin on the listing the lane proved', async () => {
      const avery = await accountHolder('Avery', {
        officialUrl: officialProfileUrl('Avery'),
        displayName: 'Avery B. Synthetic',
      });
      const twin = await nameOnlyShell('Avery');
      const twinEdge = await edgeOn(twin, 'CORE_FACULTY', {
        rosterProvenance: {
          sourceName: SOURCE_NAME,
          membershipKey: `official-profile:${centerProfileUrl('Avery')}|core-faculty`,
          observedAt: LONG_AGO,
        },
      });

      const before = await dedupeAccountlessResearcherShells({ apply: false });
      expect(before.merges.find((merge) => merge.shellId === String(twin))).toBeUndefined();

      const averyPages = {
        [centerProfileUrl('Avery')]: profilePage({ canonical: officialProfileUrl('Avery') }),
      };
      await runLane(averyPages, [member('Avery')]);
      const result = await dedupeAccountlessResearcherShells({ apply: true });

      expect(result.foldsByMatchedIdentity['roster-identity']).toBe(1);
      expect(result.merges.find((merge) => merge.shellId === String(twin))?.canonicalId).toBe(
        String(avery),
      );
      expect((await researcherById(twin))?.archived).toBe(true);
      expect((await edgeById(twinEdge))?.archived).toBe(true);
      expect(await liveEdgesOf(avery)).toHaveLength(1);

      await runLane(averyPages, [member('Avery')]);
      expect(await Researcher.countDocuments({ archived: { $ne: true } })).toBe(1);
    });

    it('archives a folded twin edge rather than handing a detached holder a live copy', async () => {
      const devon = await accountHolder('Devon');
      await edgeOn(devon, 'CORE_FACULTY', { archived: true, reviewStatus: 'DISPUTED' });
      const twin = await nameOnlyShell('Devon');
      const twinEdge = await edgeOn(twin, 'CORE_FACULTY');

      await dedupeAccountlessResearcherShells({ apply: true });

      expect((await edgeById(twinEdge))?.archived).toBe(true);
      expect(await liveEdgesOf(devon)).toHaveLength(0);
    });

    describe('a profile url two listings share names only the listing whose name agrees (#4337)', () => {
      const LAB_SITE_URL = 'https://fixture-lab.example.edu/';
      const labSiteListing = (
        first: string,
        role: CenterMember['role'],
        name = `${first} Synthetic`,
      ): CenterMember => ({ name, role, profileUrl: LAB_SITE_URL });
      const labSiteOwner = async (first: string) => {
        const owner = await accountHolder(first);
        await Researcher.updateOne(
          { _id: owner },
          {
            $set: {
              profileLinks: [
                {
                  kind: 'LAB_ABOUT',
                  purpose: 'SCHOLARLY',
                  url: LAB_SITE_URL,
                  verifiedAt: LONG_AGO,
                },
              ],
            },
          },
        );
        return owner;
      };
      const labSiteKey = (role: string) => `official-profile:${LAB_SITE_URL}|${role}`;

      it('attaches the site owner once, as the role their own listing states', async () => {
        const avery = await labSiteOwner('Avery');
        await accountHolder('Blair');

        await runLane({}, [
          labSiteListing('Avery', 'director'),
          labSiteListing('Blair', 'core-faculty'),
        ]);

        const edges = await liveEdgesOf(avery);
        expect(edges.map((row) => row.role)).toEqual(['DIRECTOR']);
        expect(edges[0].rosterProvenance).toMatchObject({
          identityBasis: 'profile-url',
          membershipKey: labSiteKey('director'),
        });
        const served = await servedNames();
        expect(served.filter((name) => name === 'Avery Synthetic')).toHaveLength(1);
      });

      it('ends the edge an earlier read attached to the site owner for the other listing', async () => {
        const avery = await labSiteOwner('Avery');
        await accountHolder('Blair');
        const roster = [
          labSiteListing('Avery', 'director'),
          labSiteListing('Blair', 'core-faculty'),
        ];
        await runLane({}, roster);
        const misattached = await edgeOn(avery, 'CORE_FACULTY', {
          rosterProvenance: {
            sourceName: SOURCE_NAME,
            profileUrl: LAB_SITE_URL,
            membershipKey: labSiteKey('core-faculty'),
            identityBasis: 'profile-url',
            observedAt: LONG_AGO,
          },
        });

        await runLane({}, roster);

        expect((await edgeById(misattached))?.state).toBe('HISTORICAL');
        expect((await liveEdgesOf(avery)).map((row) => row.role)).toEqual(['DIRECTOR']);

        await runLane({}, roster);
        expect((await liveEdgesOf(avery)).map((row) => row.role)).toEqual(['DIRECTOR']);
      });

      it('still joins a sole listing through its profile url when the listed name is misspelled', async () => {
        const avery = await labSiteOwner('Avery');

        await runLane({}, [labSiteListing('Avery', 'core-faculty', 'Avrey Synthetic')]);

        const edges = await liveEdgesOf(avery);
        expect(edges.map((row) => row.role)).toEqual(['CORE_FACULTY']);
        expect(edges[0].rosterProvenance?.identityBasis).toBe('profile-url');
      });
    });
  },
);
