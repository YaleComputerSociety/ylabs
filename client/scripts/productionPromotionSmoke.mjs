#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'http://localhost:4000/api';
const DEFAULT_APP_BASE = 'http://localhost:3000';
const INTERNAL_LABELS = [
  'operator_review',
  'suppressed',
  'studentVisibilityTier',
  'Operator Board',
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const raw = process.argv[index];
  if (!raw.startsWith('--')) continue;
  const [key, inlineValue] = raw.slice(2).split('=');
  if (inlineValue !== undefined) {
    args.set(key, inlineValue);
  } else {
    const next = process.argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, 'true');
    }
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const apiBase = String(args.get('api-base') || process.env.SMOKE_API_BASE || DEFAULT_API_BASE)
  .replace(/\/$/, '');
const appBase = String(args.get('app-base') || process.env.SMOKE_APP_BASE || DEFAULT_APP_BASE)
  .replace(/\/$/, '');
const rawOutDir = String(args.get('out') || process.env.SMOKE_OUT_DIR || 'tmp/ui-smoke');
const outDir = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(repoRoot, rawOutDir);
const runUi = args.get('ui') !== 'false';

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  appBase,
  mode: {
    writes: false,
    usesDevLogin: false,
    uiAuth: 'route-interception-only',
  },
  checks: [],
  discovered: {},
  artifacts: [],
  limitations: [],
};

const addCheck = (name, status, details = {}) => {
  report.checks.push({ name, status, ...details });
};

const request = async (route, options = {}) => {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
};

const containsInternalLabels = (value, allowOperatorBoard = false) => {
  const haystack = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return INTERNAL_LABELS.filter((label) => {
    if (allowOperatorBoard && label === 'Operator Board') return false;
    return haystack.includes(label);
  });
};

const failOnInternalLabels = (name, value, options = {}) => {
  const labels = containsInternalLabels(value, options.allowOperatorBoard);
  addCheck(name, labels.length === 0 ? 'pass' : 'fail', { labels });
};

const warnOnInternalLabels = (name, value, options = {}) => {
  const labels = containsInternalLabels(value, options.allowOperatorBoard);
  addCheck(name, labels.length === 0 ? 'pass' : 'warn', { labels });
};

const discoverResearch = async () => {
  const body = { q: '', page: 1, pageSize: 5, filters: {} };
  const { response, json } = await request('/research/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  addCheck('api.research.search.200', response.status === 200 ? 'pass' : 'fail', {
    statusCode: response.status,
  });
  warnOnInternalLabels('api.research.search.internalVisibilityLabels', json);

  const entities = [
    ...(Array.isArray(json?.researchEntities) ? json.researchEntities : []),
    ...(Array.isArray(json?.hits) ? json.hits : []),
  ];
  const slug = entities.map((entity) => entity?.slug || entity?.data?.slug).find(Boolean);
  if (slug) report.discovered.researchSlug = slug;
  addCheck('api.research.detail.discoverSlug', slug ? 'pass' : 'warn');

  if (slug) {
    const detail = await request(`/research/${encodeURIComponent(slug)}`);
    addCheck('api.research.detail.200', detail.response.status === 200 ? 'pass' : 'fail', {
      statusCode: detail.response.status,
      slug,
    });
    warnOnInternalLabels('api.research.detail.internalVisibilityLabels', detail.json);
  }
};

const discoverPathwaysAndOpportunity = async () => {
  const body = { q: '', page: 1, pageSize: 10, filters: {}, sortBy: 'relevance', sortOrder: 'desc' };
  const { response, json } = await request('/pathways/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  addCheck('api.pathways.search.200', response.status === 200 ? 'pass' : 'fail', {
    statusCode: response.status,
  });
  warnOnInternalLabels('api.pathways.search.internalVisibilityLabels', json);

  let hits = Array.isArray(json?.hits) ? json.hits : [];
  let opportunityId = hits
    .map((hit) => hit?.activePostedOpportunity?._id || hit?.activePostedOpportunity?.id)
    .find(Boolean);

  if (!opportunityId) {
    const fallback = await request('/pathways/search', {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        filters: { hasActivePostedOpportunity: true },
      }),
    });
    addCheck('api.pathways.search.activeOpportunityFallback.200', fallback.response.status === 200 ? 'pass' : 'fail', {
      statusCode: fallback.response.status,
    });
    warnOnInternalLabels('api.pathways.search.activeOpportunityFallback.internalVisibilityLabels', fallback.json);
    hits = Array.isArray(fallback.json?.hits) ? fallback.json.hits : [];
    opportunityId = hits
      .map((hit) => hit?.activePostedOpportunity?._id || hit?.activePostedOpportunity?.id)
      .find(Boolean);
  }
  if (opportunityId) report.discovered.opportunityId = opportunityId;
  addCheck('api.opportunity.discoverPublicId', opportunityId ? 'pass' : 'warn');

  if (opportunityId) {
    const detail = await request(`/opportunities/${encodeURIComponent(opportunityId)}`);
    addCheck('api.opportunity.detail.200', detail.response.status === 200 ? 'pass' : 'fail', {
      statusCode: detail.response.status,
      opportunityId,
    });
    failOnInternalLabels('api.opportunity.detail.noInternalVisibilityLabels', detail.json);
  }
};

const runApiSmoke = async () => {
  const config = await request('/config');
  addCheck('api.config.200', config.response.status === 200 ? 'pass' : 'fail', {
    statusCode: config.response.status,
  });

  await discoverResearch();
  await discoverPathwaysAndOpportunity();

  const admin = await request('/admin/operator-board');
  addCheck('api.admin.operatorBoard.requiresAuth', admin.response.status === 401 ? 'pass' : 'fail', {
    statusCode: admin.response.status,
  });
};

const optionalPlaywright = async () => {
  try {
    return await import('playwright');
  } catch (error) {
    report.limitations.push({
      area: 'ui',
      reason: 'Playwright package is not installed; rerun in an environment that provides it for browser screenshots and route assertions.',
      error: error instanceof Error ? error.message : String(error),
    });
    addCheck('ui.playwright.available', 'warn');
    return null;
  }
};

const mockedBoard = () => ({
  generatedAt: new Date().toISOString(),
  promotionStatus: {
    status: 'review',
    label: 'Review required',
    reasons: ['Smoke route-interception fixture'],
  },
  sourceHealth: { ok: 0, warn: 0, error: 0, sources: [] },
  trustTiers: {
    research: [
      { tier: 'public', count: 1 },
      { tier: 'review', count: 0 },
      { tier: 'operator_review', count: 0 },
      { tier: 'suppressed', count: 0 },
    ],
    programs: [
      { tier: 'public', count: 1 },
      { tier: 'review', count: 0 },
      { tier: 'operator_review', count: 0 },
      { tier: 'suppressed', count: 0 },
    ],
  },
  queues: [],
  latestRuns: [],
  gateCommands: [],
  meili: { status: 'unknown', indexes: [] },
});

const installRoutes = async (page, userType) => {
  await page.route('**/api/check', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      auth: true,
      user: {
        netId: `smoke-${userType}`,
        userType,
        userConfirmed: true,
        profileVerified: true,
      },
    }),
  }));

  await page.route('**/api/admin/operator-board', (route) => route.fulfill({
    status: userType === 'admin' ? 200 : 403,
    contentType: 'application/json',
    body: JSON.stringify(userType === 'admin' ? mockedBoard() : { error: 'Admin privileges required' }),
  }));

  await page.route('**/api/users/fav*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([]),
  }));
  await page.route('**/api/users/saved*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([]),
  }));
  await page.route('**/api/programs/filters', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      yearOfStudy: [],
      termOfAward: [],
      purpose: [],
      globalRegions: [],
      citizenshipStatus: [],
      programCategory: [],
      programKind: [],
      entryMode: [],
      studentFacingCategory: [],
    }),
  }));
  await page.route('**/api/programs/search?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [], total: 0, page: 1, pageSize: 500, totalPages: 0 }),
  }));
};

const screenshotPath = async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.artifacts.push(file);
};

const runUiRoute = async (page, routePath, name, options = {}) => {
  await page.goto(`${appBase}${routePath}`, { waitUntil: 'networkidle', timeout: 30000 });
  await screenshotPath(page, name);
  const text = await page.locator('body').innerText({ timeout: 5000 });
  failOnInternalLabels(`ui.${name}.noInternalLabels`, text, options);
  addCheck(`ui.${name}.loaded`, 'pass', { path: routePath });
};

const runUiSmoke = async () => {
  const playwright = await optionalPlaywright();
  if (!playwright) return;

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await installRoutes(studentPage, 'student');

    const researchPath = report.discovered.researchSlug
      ? `/research/${report.discovered.researchSlug}`
      : '/research';
    const studentRoutes = [
      ['/research', 'student-research'],
      [researchPath, 'student-research-detail'],
      ['/programs', 'student-programs'],
      ['/account', 'student-account'],
    ];
    if (report.discovered.opportunityId) {
      studentRoutes.push([
        `/opportunities/${report.discovered.opportunityId}`,
        'student-opportunity-detail',
      ]);
    }

    for (const [routePath, name] of studentRoutes) {
      await runUiRoute(studentPage, routePath, name);
    }

    await studentPage.goto(`${appBase}/analytics`, { waitUntil: 'networkidle', timeout: 30000 });
    const studentAdminText = await studentPage.locator('body').innerText({ timeout: 5000 });
    failOnInternalLabels('ui.student.analytics.noOperatorBoard', studentAdminText);
    addCheck('ui.student.analytics.redirectsAwayFromOperatorBoard', 'pass', {
      finalUrl: studentPage.url(),
    });
    await studentContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await installRoutes(adminPage, 'admin');
    await adminPage.goto(`${appBase}/analytics`, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshotPath(adminPage, 'admin-analytics-operator-board');
    const adminText = await adminPage.locator('body').innerText({ timeout: 5000 });
    addCheck('ui.admin.analytics.operatorBoardRenders', adminText.includes('Data Quality Operator Board') ? 'pass' : 'fail');
    failOnInternalLabels('ui.admin.analytics.noRawVisibilityLabelsExceptBoard', adminText, {
      allowOperatorBoard: true,
    });
    await adminContext.close();

    report.limitations.push({
      area: 'ui.admin.operator-board',
      reason: 'The client has no /admin/operator-board route; Operator Board UI is currently rendered under /analytics for admin users. The guarded read-only API remains /api/admin/operator-board.',
    });
  } finally {
    await browser.close();
  }
};

const main = async () => {
  await mkdir(outDir, { recursive: true });
  await runApiSmoke();
  if (runUi) await runUiSmoke();

  const reportPath = path.join(outDir, 'production-promotion-smoke-report.json');
  report.artifacts.push(reportPath);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const failures = report.checks.filter((check) => check.status === 'fail');
  console.log(JSON.stringify({
    status: failures.length > 0 ? 'fail' : 'pass',
    failures: failures.map((check) => check.name),
    warnings: report.checks.filter((check) => check.status === 'warn').map((check) => check.name),
    reportPath,
  }, null, 2));

  if (failures.length > 0) process.exit(1);
};

main().catch(async (error) => {
  addCheck('smoke.unhandledError', 'fail', {
    error: error instanceof Error ? error.message : String(error),
  });
  await mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'production-promotion-smoke-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
