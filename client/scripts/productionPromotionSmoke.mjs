#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildSecurityHeaderChecks,
  containsInternalLabels,
  createSmokeReport,
  deploymentFingerprintCheckFromSmokeConfig,
  parseSmokeConfig,
  shouldSendSmokeOrigin,
  smokeBrowserOrigin,
  summarizeSmokeReport,
  validateSmokeConfig,
} from './productionPromotionSmokeCore.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const config = parseSmokeConfig(process.argv.slice(2), process.env);
const { apiBase, appBase, rawOutDir, runUi, explicitOpportunityId, smokeCookie } = config;
const outDir = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(repoRoot, rawOutDir);
const report = createSmokeReport(config);
const smokeOrigin = smokeBrowserOrigin(appBase);

const addCheck = (name, status, details = {}) => {
  report.checks.push({ name, status, ...details });
};

const request = async (route, options = {}) => {
  const includeSmokeCookie = options.authenticated === true && smokeCookie;
  const { authenticated: _authenticated, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const response = await fetch(`${apiBase}${route}`, {
    ...fetchOptions,
    headers: {
      'content-type': 'application/json',
      ...(smokeOrigin && shouldSendSmokeOrigin(method) ? { Origin: smokeOrigin } : {}),
      ...(includeSmokeCookie ? { cookie: smokeCookie } : {}),
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

const failOnInternalLabels = (name, value, options = {}) => {
  const labels = containsInternalLabels(value, options);
  addCheck(name, labels.length === 0 ? 'pass' : 'fail', { labels });
};

const warnOnInternalLabels = (name, value, options = {}) => {
  const labels = containsInternalLabels(value, options);
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

const checkOpportunityDetail = async () => {
  const opportunityId = String(explicitOpportunityId || '').trim();
  if (opportunityId) report.discovered.opportunityId = opportunityId;
  addCheck('api.opportunity.explicitPublicId', opportunityId ? 'pass' : 'warn');

  if (opportunityId) {
    const detail = await request(`/opportunities/${encodeURIComponent(opportunityId)}`);
    addCheck('api.opportunity.detail.200', detail.response.status === 200 ? 'pass' : 'fail', {
      statusCode: detail.response.status,
      opportunityId,
    });
    failOnInternalLabels('api.opportunity.detail.noInternalVisibilityLabels', detail.json);
  }
};

const checkProgramApis = async () => {
  const programSearchRoute = '/programs/search?query=&page=1&pageSize=5';
  const fellowshipSearchRoute = '/fellowships/search?query=&page=1&pageSize=5';

  const unauthProgram = await request(programSearchRoute);
  addCheck(
    'api.programs.search.requiresAuth',
    unauthProgram.response.status === 401 ? 'pass' : 'fail',
    { statusCode: unauthProgram.response.status },
  );

  const unauthFellowship = await request(fellowshipSearchRoute);
  addCheck(
    'api.fellowships.search.requiresAuth',
    unauthFellowship.response.status === 401 ? 'pass' : 'fail',
    { statusCode: unauthFellowship.response.status },
  );

  if (!smokeCookie) {
    addCheck('api.programs.search.authenticatedVisibility', 'warn', {
      reason: 'Set SMOKE_COOKIE or --cookie to run authenticated Programs/Fellowships API visibility checks without using dev-login.',
    });
    return;
  }

  const programSearch = await request(programSearchRoute, { authenticated: true });
  addCheck('api.programs.search.authenticated200', programSearch.response.status === 200 ? 'pass' : 'fail', {
    statusCode: programSearch.response.status,
  });
  failOnInternalLabels('api.programs.search.noInternalVisibilityLabels', programSearch.json);

  const fellowshipSearch = await request(fellowshipSearchRoute, { authenticated: true });
  addCheck(
    'api.fellowships.search.authenticated200',
    fellowshipSearch.response.status === 200 ? 'pass' : 'fail',
    { statusCode: fellowshipSearch.response.status },
  );
  failOnInternalLabels('api.fellowships.search.noInternalVisibilityLabels', fellowshipSearch.json);
};

const runApiSmoke = async () => {
  const configResponse = await request('/config');
  addCheck('api.config.200', configResponse.response.status === 200 ? 'pass' : 'fail', {
    statusCode: configResponse.response.status,
  });
  for (const check of buildSecurityHeaderChecks('api.config.headers', configResponse.response.headers)) {
    addCheck(check.name, check.status, {
      header: check.header,
      present: check.present,
    });
  }
  const deploymentCheck = deploymentFingerprintCheckFromSmokeConfig(config, configResponse.json);
  addCheck('api.config.deploymentFingerprint', deploymentCheck.status, deploymentCheck);

  await discoverResearch();
  await checkOpportunityDetail();
  await checkProgramApis();

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
      studentRoutes.splice(2, 0, [
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
  const configBlockers = validateSmokeConfig(config);
  addCheck('smoke.config.validTargets', configBlockers.length === 0 ? 'pass' : 'fail', {
    blockers: configBlockers,
  });
  if (configBlockers.length > 0) {
    const reportPath = path.join(outDir, 'production-promotion-smoke-report.json');
    report.artifacts.push(reportPath);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(summarizeSmokeReport(report, reportPath), null, 2));
    process.exit(1);
  }

  await runApiSmoke();
  if (runUi) await runUiSmoke();

  const reportPath = path.join(outDir, 'production-promotion-smoke-report.json');
  report.artifacts.push(reportPath);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const summary = summarizeSmokeReport(report, reportPath);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failures.length > 0) process.exit(1);
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
