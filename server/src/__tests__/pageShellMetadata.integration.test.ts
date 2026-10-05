import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = '__Host-session';
const SERVED_SLUG = 'synthetic-kelp-forest-lab';
const WITHHELD_SLUG = 'synthetic-withheld-lab';
const MERGED_SHELL_SLUG = 'synthetic-kelp-forest-lab-old';
const SERVED_NAME = 'Synthetic Kelp Forest Lab';
const SHORT_DESCRIPTION =
  'Studies how kelp forest food webs respond to warming coastal water along the New England shore.';
const FULL_DESCRIPTION =
  'The lab studies how kelp forest food webs respond to warming coastal water, combining diver surveys of urchin grazing, tank experiments on kelp recruitment, and long-term monitoring of temperature and canopy cover at sites along the New England shore.';
const LEAD_EMAIL = 'synthetic.lead@example.edu';
const LEAD_NAME = 'Synthetic Lead Person';
const WITHHELD_NAME = 'Synthetic Withheld Lab';
const ORIGINAL_ENV = { ...process.env };
const clientIndexHtmlPath = fileURLToPath(new URL('../../../client/index.html', import.meta.url));

const metaContent = (html: string, attribute: string, key: string): string[] =>
  Array.from(
    html.matchAll(new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"`, 'gi')),
    (match) => match[1],
  );

const titleOf = (html: string): string | undefined => html.match(/<title>([^<]*)<\/title>/i)?.[1];

const canonicalOf = (html: string): string[] =>
  Array.from(html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/gi), (match) => match[1]);

const headOf = (html: string): string => html.slice(0, html.indexOf('</head>'));

describe('the page shell carries per-page share metadata (#4240)', () => {
  let replSet: MongoMemoryReplSet;
  let fixtureRoot = '';
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'ylabs-page-shell-'));
    const clientDistPath = path.join(fixtureRoot, 'client', 'dist');
    mkdirSync(clientDistPath, { recursive: true });
    copyFileSync(clientIndexHtmlPath, path.join(clientDistPath, 'index.html'));
    vi.doMock('../utils/serverPackageRoot', () => ({
      resolveServerPackageRoot: () => path.join(fixtureRoot, 'server'),
    }));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };
    const { default: app } = await import('../app');
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
    rmSync(fixtureRoot, { recursive: true, force: true });
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    const servedId = new mongoose.Types.ObjectId();
    const sourceUrl = 'https://medicine.yale.edu/lab/synthetic-kelp/';
    const servedRow = {
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Ecology and Evolutionary Biology'],
      researchAreas: ['Marine Ecology'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      email: LEAD_EMAIL,
      contactEmail: LEAD_EMAIL,
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl },
      },
    };
    await db.collection('research_entities').insertMany([
      {
        ...servedRow,
        _id: servedId,
        slug: SERVED_SLUG,
        name: SERVED_NAME,
        displayName: SERVED_NAME,
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      },
      {
        ...servedRow,
        slug: WITHHELD_SLUG,
        name: WITHHELD_NAME,
        displayName: WITHHELD_NAME,
        studentVisibilityTier: 'limited_but_safe',
      },
      {
        ...servedRow,
        slug: MERGED_SHELL_SLUG,
        name: SERVED_NAME,
        archived: true,
        canonicalGroupId: servedId,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName: LEAD_NAME,
      profile: { title: 'Professor', email: LEAD_EMAIL },
      email: LEAD_EMAIL,
      status: 'ACTIVE',
      profileLinks: [],
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      schemaVersion: 1,
      target: { kind: 'RESEARCH_ENTITY', id: servedId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      rosterProvenance: { sourceName: 'ysm-faculty', sourceUrl, observedAt: new Date() },
    });
  });

  it('serves a student_ready row its own title, served description and yalelabs.io canonical', async () => {
    const response = await fetch(`${baseUrl}/research/${SERVED_SLUG}?q=kelp`, {
      headers: { 'x-forwarded-proto': 'https', host: 'yalelabs.onrender.com' },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(titleOf(html)).toBe(`${SERVED_NAME} | y/labs`);
    expect(metaContent(html, 'property', 'og:title')).toEqual([SERVED_NAME]);
    expect(metaContent(html, 'name', 'description')[0]).toBe(SHORT_DESCRIPTION);
    expect(metaContent(html, 'property', 'og:url')).toEqual([
      `https://yalelabs.io/research/${SERVED_SLUG}`,
    ]);
    expect(canonicalOf(html)).toEqual([`https://yalelabs.io/research/${SERVED_SLUG}`]);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(
      response.headers.getSetCookie().filter((c) => c.startsWith(SESSION_COOKIE_NAME)),
    ).toEqual([]);
  });

  it('never puts a member name or contact field into the head', async () => {
    const html = await (await fetch(`${baseUrl}/research/${SERVED_SLUG}`)).text();
    const head = headOf(html);

    expect(head).not.toContain(LEAD_EMAIL);
    expect(head).not.toContain(LEAD_NAME);
    expect(head).not.toContain('mailto:');
  });

  it('answers a row the detail endpoint withholds with a 404 and the generic shell, like the API', async () => {
    const page = await fetch(`${baseUrl}/research/${WITHHELD_SLUG}`);
    const html = await page.text();
    const api = await fetch(`${baseUrl}/api/research/${WITHHELD_SLUG}`);
    await api.text();

    expect(api.status).toBe(404);
    expect(page.status).toBe(404);
    expect(html).not.toContain(WITHHELD_NAME);
    expect(canonicalOf(html)).toEqual([]);
    expect(metaContent(html, 'property', 'og:title')).toEqual(['y/labs']);
  });

  it('answers an unknown slug with a 404 shell', async () => {
    const response = await fetch(`${baseUrl}/research/synthetic-no-such-row`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain('<div id="root"></div>');
  });

  it('redirects a merged shell permanently to its canonical page', async () => {
    const response = await fetch(`${baseUrl}/research/${MERGED_SHELL_SLUG}`, {
      redirect: 'manual',
    });
    await response.text();

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`/research/${SERVED_SLUG}`);
  });

  it('points every research listing view at one query-free canonical', async () => {
    const html = await (await fetch(`${baseUrl}/research?q=kelp&school=synthetic`)).text();

    expect(titleOf(html)).toBe('Research | y/labs');
    expect(canonicalOf(html)).toEqual(['https://yalelabs.io/research']);
  });

  it('meters shell lookups per IPv6 subnet and serves an over-budget client the unmodified shell', async () => {
    const { PAGE_SHELL_LOOKUPS_PER_CLIENT_WINDOW } = await import(
      '../services/pageShellMetadataService'
    );
    const fromAddress = (address: string, slug: string) =>
      fetch(`${baseUrl}/research/${slug}`, { headers: { 'x-forwarded-for': address } });

    for (let lookup = 0; lookup < PAGE_SHELL_LOOKUPS_PER_CLIENT_WINDOW; lookup += 1) {
      const response = await fromAddress(
        `2001:db8:1:1::${(lookup + 1).toString(16)}`,
        `synthetic-budget-row-${lookup}`,
      );
      await response.text();
      expect(response.status).toBe(404);
    }

    const overBudget = await fromAddress('2001:db8:1:1:ffff::1', 'synthetic-over-budget-row');
    const overBudgetHtml = await overBudget.text();
    const otherSubnet = await fromAddress('2001:db8:2::1', 'synthetic-other-subnet-row');
    await otherSubnet.text();

    expect(overBudget.status).toBe(200);
    expect(canonicalOf(overBudgetHtml)).toEqual([]);
    expect(overBudget.headers.getSetCookie()).toEqual([]);
    expect(otherSubnet.status).toBe(404);
  });
});
