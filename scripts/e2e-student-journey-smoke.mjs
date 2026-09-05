import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL_SMOKE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEPLOYED_SMOKE_HOSTS = new Set([
  'yalelabs.io',
  'www.yalelabs.io',
  'yalelabs.onrender.com',
  'ylabs-gr4v.onrender.com',
]);

const SMOKE_ENTITY_NAME = 'Quokka Cognition Lab';
const SMOKE_ENTITY_SLUG = 'e2e-smoke-quokka-cognition-lab';
const SMOKE_SEARCH_TOKEN = 'quokka';
const SMOKE_ZERO_RESULT_QUERY = 'zzqxwphantomtopicnobodystudies';
const SMOKE_ZERO_RESULT_COPY =
  'No indexed research homes matched this search yet. This is a coverage gap, not proof that no such research exists at Yale. Try one of the recovery options below while coverage improves.';

const isInsidePath = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

const safeSmokeBaseUrl = (raw, name) => {
  const value = String(raw || '').trim();
  if (!value || value.length > 2048) throw new Error(`${name} must be a bounded URL`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP(S)`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not include credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not include query or fragment text`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLocal = LOCAL_SMOKE_HOSTS.has(hostname);
  const isDeployed = DEPLOYED_SMOKE_HOSTS.has(hostname);
  if (!isLocal && !isDeployed) {
    throw new Error(`${name} must point to localhost or a y/labs deployment`);
  }
  if (isDeployed && parsed.protocol !== 'https:') {
    throw new Error(`${name} deployed origins must use HTTPS`);
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/g, '')}`;
};

const safeSmokeOutputDir = (raw) => {
  const value = String(raw || 'tmp/e2e-student-journey-smoke').trim();
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('OUT_DIR must be a bounded path');
  }
  const resolved = path.resolve(value);
  const repoTmp = path.resolve('tmp');
  const systemTmp = path.resolve('/tmp');
  if (!isInsidePath(repoTmp, resolved) && !isInsidePath(systemTmp, resolved)) {
    throw new Error('OUT_DIR must stay under repo tmp/ or /tmp');
  }
  return resolved;
};

const baseUrl = safeSmokeBaseUrl(process.env.E2E_BASE_URL || 'http://localhost:4000', 'E2E_BASE_URL');
const outDir = safeSmokeOutputDir(process.env.OUT_DIR);

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const failures = [];
const steps = [];

const record = (name, details = {}) => steps.push({ name, ...details });

const screenshot = async (name, targetPage = page) => {
  const file = path.join(outDir, `${name}.png`);
  try {
    await targetPage.screenshot({ path: file, fullPage: true });
    record('screenshot', { file });
  } catch (error) {
    record('screenshot', { file, error: error instanceof Error ? error.message : String(error) });
  }
};

const bodyText = async (targetPage = page) =>
  targetPage.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

const failureContext = async () => {
  try {
    const url = page.url();
    const preview = (await bodyText()).slice(0, 600);
    return { url, preview };
  } catch {
    return {};
  }
};

const step = async (name, fn) => {
  try {
    await fn();
    record(name, { status: 'pass' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const context = await failureContext();
    failures.push({ name, message, ...context });
    record(name, { status: 'fail', message, ...context });
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertTextIncludes = async (expected, targetPage = page) => {
  const text = await bodyText(targetPage);
  assert(text.includes(expected), `Expected page text to include "${expected}".`);
};

const settleResearchPage = async (targetPage = page) => {
  await targetPage.waitForLoadState('domcontentloaded');
  await targetPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
};

const submitSearch = async (query) => {
  await page.getByLabel('Search Yale research').fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .waitForFunction(
      () => !document.body.innerText.includes('Searching y/labs for'),
      undefined,
      { timeout: 20000 },
    )
    .catch(() => undefined);
  await settleResearchPage();
};

const readAuthState = async () =>
  page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const payload = await response.json();
      return { status: response.status, auth: Boolean(payload && payload.auth) };
    } catch (error) {
      return { status: 0, auth: false, error: String(error) };
    }
  }, `${baseUrl}/api/check`);

const login = async () => {
  const deadline = Date.now() + 45000;
  let state = { status: 0, auth: false };
  while (Date.now() < deadline) {
    await page
      .goto(`${baseUrl}/api/dev-login?redirect=/research`, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);
    await settleResearchPage();
    state = await readAuthState();
    if (state.auth) return;
    await page.waitForTimeout(2000);
  }
  assert(
    state.auth,
    `dev-login never established an authenticated session within 45s (GET /api/check -> ${JSON.stringify(state)}).`,
  );
};

await step('signed-in student reaches the research browse home', async () => {
  await login();
  await page.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page
    .getByRole('heading', { level: 1, name: 'Find a Yale lab that fits you.' })
    .waitFor({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Research homes to explore' }).waitFor({ timeout: 20000 });
  await assertTextIncludes(SMOKE_ENTITY_NAME);
});
await screenshot('01-browse-home');

await step('search returns a result and the header settles out of loading', async () => {
  await submitSearch(SMOKE_SEARCH_TOKEN);
  const searchButton = page.getByRole('button', { name: 'Search', exact: true });
  await searchButton.waitFor({ timeout: 20000 });
  assert(
    (await page.getByRole('button', { name: 'Searching...', exact: true }).count()) === 0,
    'Search button is stuck in the "Searching..." loading state.',
  );
  assert(!(await searchButton.isDisabled()), 'Search button remained disabled after results loaded.');
  const status = await page
    .locator('section[aria-label="Search results"]')
    .getByRole('status')
    .first()
    .innerText();
  assert(
    /research homes? for '.+'/i.test(status.replace(/\s+/g, ' ')),
    `Search summary never settled out of the loading state (got "${status}").`,
  );
  await page
    .getByRole('link', { name: SMOKE_ENTITY_NAME })
    .first()
    .waitFor({ timeout: 20000 });
});
await screenshot('02-search-results');

await step('opening a result renders the detail identity and description', async () => {
  await page.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().click();
  await settleResearchPage();
  assert(
    new URL(page.url()).pathname === `/research/${SMOKE_ENTITY_SLUG}`,
    `Expected detail URL /research/${SMOKE_ENTITY_SLUG}, got ${page.url()}.`,
  );
  await page.getByRole('heading', { level: 1, name: SMOKE_ENTITY_NAME }).waitFor({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Research summary' }).waitFor({ timeout: 20000 });
  await assertTextIncludes('marsupials');
});
await screenshot('03-detail');

await step('a signed-in student saves the entity and it persists', async () => {
  await page.getByRole('button', { name: 'Save research plan' }).click();
  await page.getByRole('button', { name: 'Saved to Dashboard' }).waitFor({ timeout: 20000 });
});
await screenshot('04-detail-saved');

await step('the saved entity appears on the dashboard', async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page.getByRole('tab', { name: /^Dashboard/ }).click();
  await page
    .getByRole('heading', { name: 'Saved research plans', exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().waitFor({ timeout: 20000 });
});
await screenshot('05-account-saved');

await step('a zero-result search renders an honest empty state, not an error', async () => {
  await page.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await submitSearch(SMOKE_ZERO_RESULT_QUERY);
  await assertTextIncludes(SMOKE_ZERO_RESULT_COPY);
  await page
    .getByRole('button', { name: 'Browse all research homes', exact: true })
    .waitFor({ timeout: 20000 });
  assert(
    (await page.getByRole('alert').count()) === 0,
    'Zero-result search surfaced an error alert instead of an honest empty state.',
  );
});
await screenshot('06-zero-results');

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  outDir,
  failures,
  steps,
};

await fs.writeFile(
  path.join(outDir, 'e2e-student-journey-smoke.json'),
  JSON.stringify(summary, null, 2),
);

await browser.close();

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
