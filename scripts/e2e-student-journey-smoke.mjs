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
  'No indexed research matched this search yet. This is a coverage gap, not proof that no such research exists at Yale. Try one of the recovery options below while coverage improves.';

const isInsidePath = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
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

const baseUrl = safeSmokeBaseUrl(
  process.env.E2E_BASE_URL || 'http://localhost:4000',
  'E2E_BASE_URL',
);
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

const FOCUS_RING_OFFSET = 2;
const FOCUS_RING_WIDTH = 2;

const focusRingStrips = (box) => {
  const reach = FOCUS_RING_OFFSET + FOCUS_RING_WIDTH;
  return {
    top: { x: box.x, y: box.y - reach, width: box.width, height: FOCUS_RING_WIDTH },
    right: {
      x: box.x + box.width + FOCUS_RING_OFFSET,
      y: box.y,
      width: FOCUS_RING_WIDTH,
      height: box.height,
    },
    bottom: {
      x: box.x,
      y: box.y + box.height + FOCUS_RING_OFFSET,
      width: box.width,
      height: FOCUS_RING_WIDTH,
    },
    left: { x: box.x - reach, y: box.y, width: FOCUS_RING_WIDTH, height: box.height },
  };
};

const captureStrips = async (strips) => {
  const captured = {};
  for (const [side, clip] of Object.entries(strips)) {
    captured[side] = await page.screenshot({ clip });
  }
  return captured;
};

// Computed style reports the outline even when an ancestor clips it or a later
// sibling paints over it, so only the pixels on each side of the box can tell.
const assertFocusRingPaintsEverySide = async (control, label) => {
  assert(
    await control.evaluate((element) => element.matches(':focus-visible')),
    `${label} did not take keyboard focus.`,
  );
  const box = await control.boundingBox();
  assert(box, `${label} has no layout box.`);
  const strips = focusRingStrips(box);
  const focused = await captureStrips(strips);
  await control.evaluate((element) => element.blur());
  const blurred = await captureStrips(strips);
  const unpainted = Object.keys(strips).filter((side) => focused[side].equals(blurred[side]));
  assert(
    unpainted.length === 0,
    `${label} focus ring paints nothing on its ${unpainted.join(', ')} side(s).`,
  );
};

const focusByKeyboard = async (control) => {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
};

const settleResearchPage = async (targetPage = page) => {
  await targetPage.waitForLoadState('domcontentloaded');
  await targetPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
};

const submitSearch = async (query) => {
  await page.getByLabel('Search y/labs').fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .waitForFunction(() => !document.body.innerText.includes('Searching y/labs for'), undefined, {
      timeout: 20000,
    })
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
  await page.getByRole('heading', { name: 'Research to explore' }).waitFor({ timeout: 20000 });
  await assertTextIncludes(SMOKE_ENTITY_NAME);
});
await screenshot('01-browse-home');

await step('the wide-screen research sidebar fits every filter without its own scrollbar', async () => {
  const laptopPage = await context.newPage();
  try {
    const sidebar = laptopPage.locator('header', {
      has: laptopPage.getByRole('heading', { level: 1, name: 'Find a Yale lab that fits you.' }),
    });
    const assertSidebarFits = async (state) => {
      const { scrollHeight, clientHeight } = await sidebar.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      const { width, height } = laptopPage.viewportSize();
      assert(
        scrollHeight <= clientHeight,
        `The sticky research sidebar overflows ${state} at ${width}x${height}: ${scrollHeight}px of content in ${clientHeight}px.`,
      );
    };
    for (const height of [800, 720]) {
      await laptopPage.setViewportSize({ width: 1280, height });
      await laptopPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
      await settleResearchPage(laptopPage);
      for (const axis of ['type', 'school', 'department']) {
        await sidebar.getByLabel(`Filter by ${axis}`).waitFor({ timeout: 20000 });
      }
      await assertSidebarFits('while browsing');
      await sidebar.getByLabel('Search y/labs').fill(SMOKE_SEARCH_TOKEN);
      await assertSidebarFits('with a query typed');
      await sidebar.getByRole('button', { name: 'Search', exact: true }).click();
      await laptopPage
        .locator('section[aria-label="Search results"]')
        .getByRole('status')
        .filter({ hasText: /results? for '.+'/i })
        .first()
        .waitFor({ timeout: 20000 });
      await settleResearchPage(laptopPage);
      await assertSidebarFits('after a search');
    }
  } finally {
    await laptopPage.close();
  }
});

await step('search returns a result and the header settles out of loading', async () => {
  await submitSearch(SMOKE_SEARCH_TOKEN);
  const searchButton = page.getByRole('button', { name: 'Search', exact: true });
  await searchButton.waitFor({ timeout: 20000 });
  assert(
    (await page.getByRole('button', { name: 'Searching...', exact: true }).count()) === 0,
    'Search button is stuck in the "Searching..." loading state.',
  );
  assert(
    !(await searchButton.isDisabled()),
    'Search button remained disabled after results loaded.',
  );
  const status = await page
    .locator('section[aria-label="Search results"]')
    .getByRole('status')
    .first()
    .innerText();
  assert(
    /results? for '.+'/i.test(status.replace(/\s+/g, ' ')),
    `Search summary never settled out of the loading state (got "${status}").`,
  );
  await page.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().waitFor({ timeout: 20000 });
});
await screenshot('02-search-results');

await step('opening a result renders the detail identity and description', async () => {
  await page.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().click();
  await settleResearchPage();
  assert(
    new URL(page.url()).pathname === `/research/${SMOKE_ENTITY_SLUG}`,
    `Expected detail URL /research/${SMOKE_ENTITY_SLUG}, got ${page.url()}.`,
  );
  await page
    .getByRole('heading', { level: 1, name: SMOKE_ENTITY_NAME })
    .waitFor({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Research summary' }).waitFor({ timeout: 20000 });
  await assertTextIncludes('marsupials');
});
await screenshot('03-detail');

await step('a signed-in student saves the entity and it persists', async () => {
  // The button label is optimistic: `useFavorites.setFavorite` updates local state
  // BEFORE awaiting the PUT, and on failure it rolls back a frame later. So waiting
  // for "Saved to Dashboard" asserts the click, not the save, and this step's own name
  // claims persistence it never checked. That is why it and the dashboard step could
  // disagree inside one run: one read client state and the next read the server's
  // (#3387). Asserting the response makes a lost write fail here, with a status code,
  // instead of surfacing as a mystery timeout on the next step.
  const savedOnServer = page.waitForResponse(
    (response) =>
      response.url().includes('/users/savedResearchEntities') &&
      response.request().method() === 'PUT',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Save research plan' }).click();
  const response = await savedOnServer;
  assert(
    response.ok(),
    `Saving the research plan returned HTTP ${response.status()}, so nothing was stored.`,
  );
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
  // A timeout here after the save step asserted a 2xx is a read-after-write gap rather
  // than a lost write, and saying which is the point of reporting the server's own
  // answer alongside the failure instead of widening the wait (#3387).
  try {
    await page.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().waitFor({ timeout: 20000 });
  } catch (error) {
    const stored = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/users/savedResearchEntities', { credentials: 'include' });
        return `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
      } catch (fetchError) {
        return `read failed: ${String(fetchError)}`;
      }
    });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nServer saved-plan state at failure: ${stored}`,
    );
  }
});
await screenshot('05-account-saved');

await step('each dashboard surface tab paints a full keyboard focus ring', async () => {
  const tabs = page.getByRole('tablist', { name: 'Dashboard surfaces' });
  const plansTab = tabs.getByRole('tab', { name: /^Dashboard/ });
  const programsTab = tabs.getByRole('tab', { name: /^Program Watch/ });
  await plansTab.scrollIntoViewIfNeeded();
  await plansTab.focus();
  await page.keyboard.press('ArrowRight');
  await assertFocusRingPaintsEverySide(programsTab, 'The Program Watch tab');
  await programsTab.focus();
  await page.keyboard.press('ArrowLeft');
  await assertFocusRingPaintsEverySide(plansTab, 'The Dashboard tab');
});

await step('each program view-mode segment paints a full keyboard focus ring', async () => {
  await page.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  const listView = page.getByRole('button', { name: 'List view', exact: true });
  await listView.click();
  for (const name of ['Card view', 'List view', 'Compact view']) {
    const segment = page.getByRole('button', { name, exact: true });
    await segment.scrollIntoViewIfNeeded();
    await focusByKeyboard(segment);
    await assertFocusRingPaintsEverySide(segment, `The ${name} segment`);
  }
});

await step('a zero-result search renders an honest empty state, not an error', async () => {
  await page.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await submitSearch(SMOKE_ZERO_RESULT_QUERY);
  await assertTextIncludes(SMOKE_ZERO_RESULT_COPY);
  await page
    .getByRole('button', { name: 'Browse all research', exact: true })
    .waitFor({ timeout: 20000 });
  assert(
    (await page.getByRole('alert').count()) === 0,
    'Zero-result search surfaced an error alert instead of an honest empty state.',
  );
});
await screenshot('06-zero-results');

await step('the first Tab on first load reaches the skip link', async () => {
  await page.goto(`${baseUrl}/about`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
  await page.keyboard.press('Tab');
  const firstTabStop = await page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return 'nothing';
    return `${focused.tagName.toLowerCase()} "${(focused.textContent ?? '').trim().slice(0, 40)}"`;
  });
  assert(
    firstTabStop === 'a "Skip to main content"',
    `The first Tab on /about landed on ${firstTabStop} instead of the skip link.`,
  );
});

await step('the keyboard scrolls a page on first load without a click', async () => {
  await page.goto(`${baseUrl}/about`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
  await page.keyboard.press('PageDown');
  await page
    .waitForFunction(
      () => (document.querySelector('[data-scroll-container]')?.scrollTop ?? 0) > 0,
      undefined,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  const scrollTop = await page.evaluate(
    () => document.querySelector('[data-scroll-container]')?.scrollTop ?? 0,
  );
  assert(scrollTop > 0, `PageDown on /about left the page scroller at ${scrollTop}.`);
});

await step('shift-tabbing back through results never parks focus under the sticky filter bar', async () => {
  const narrowPage = await context.newPage();
  try {
    await narrowPage.setViewportSize({ width: 640, height: 400 });
    await narrowPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
    await settleResearchPage(narrowPage);
    await narrowPage.getByRole('link', { name: SMOKE_ENTITY_NAME }).first().waitFor({ timeout: 20000 });
    await narrowPage.locator('#main-content').focus();
    const tabStops = 60;
    for (let press = 0; press < tabStops; press += 1) await narrowPage.keyboard.press('Tab');
    const obscured = [];
    for (let press = 0; press < tabStops; press += 1) {
      await narrowPage.keyboard.press('Shift+Tab');
      const stop = await narrowPage.evaluate(() => {
        const focused = document.activeElement;
        const main = document.getElementById('main-content');
        if (!focused || !main?.contains(focused) || focused === main) return null;
        const bars = [...document.querySelectorAll('[data-scroll-container] .sticky.top-0')];
        if (bars.length === 0 || bars.some((bar) => bar.contains(focused))) return null;
        const rect = focused.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !bars.some((bar) => bar.contains(hit))) return null;
        return `${focused.tagName.toLowerCase()} at y ${Math.round(rect.top)}-${Math.round(rect.bottom)}`;
      });
      if (stop) obscured.push(stop);
    }
    assert(
      obscured.length === 0,
      `${obscured.length} focus stops were centred under the sticky filter bar at 640x400, first: ${obscured[0]}.`,
    );
  } finally {
    await narrowPage.close();
  }
});

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
