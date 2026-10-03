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
const SMOKE_WITHHELD_ENTITIES = [
  {
    slug: 'e2e-smoke-withheld-review-quokka-lab',
    name: 'Quokka Pending Review Lab',
    copy: 'Awaits operator review before it may reach students',
  },
  {
    slug: 'e2e-smoke-withheld-suppressed-quokka-lab',
    name: 'Quokka Suppressed Record Lab',
    copy: 'Is suppressed from students',
  },
];
const SMOKE_CONTACT_ENTITY_NAME = 'Quokka Burrow Acoustics Lab';
const SMOKE_CONTACT_ENTITY_SLUG = 'e2e-smoke-quokka-burrow-acoustics-lab';
const SMOKE_CONTACT_DETAILS = ['quokka.coordinator@example.invalid', '203-555-0147'];
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

const failureContext = async (targetPage = page) => {
  try {
    const url = targetPage.url();
    const preview = (await bodyText(targetPage)).slice(0, 600);
    return { url, preview };
  } catch {
    return {};
  }
};

const withFailureContextOf = async (targetPage, fn) => {
  try {
    return await fn();
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.failureContext = await failureContext(targetPage);
    throw failure;
  }
};

const step = async (name, fn) => {
  try {
    await fn();
    record(name, { status: 'pass' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const context = error?.failureContext ?? (await failureContext());
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

await step(
  'the wide-screen research sidebar fits every filter without its own scrollbar',
  async () => {
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
  },
);

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

const assertNoWithheldEntityIsServed = async (surface) => {
  const text = await bodyText();
  const html = await page.content();
  for (const entity of SMOKE_WITHHELD_ENTITIES) {
    for (const value of [entity.name, entity.copy]) {
      assert(
        !text.includes(value) && !html.includes(value),
        `${surface} served a withheld-tier row (${entity.slug}).`,
      );
    }
  }
};

await step('withheld-tier rows never reach browse, search, or detail', async () => {
  await page.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page.getByRole('heading', { name: 'Research to explore' }).waitFor({ timeout: 20000 });
  await assertTextIncludes(SMOKE_ENTITY_NAME);
  await assertNoWithheldEntityIsServed('Browse');

  await submitSearch(SMOKE_SEARCH_TOKEN);
  await page
    .getByRole('link', { name: SMOKE_CONTACT_ENTITY_NAME })
    .first()
    .waitFor({ timeout: 20000 });
  await assertNoWithheldEntityIsServed(`Search for '${SMOKE_SEARCH_TOKEN}'`);

  for (const entity of SMOKE_WITHHELD_ENTITIES) {
    await page.goto(`${baseUrl}/research/${entity.slug}`, { waitUntil: 'domcontentloaded' });
    await settleResearchPage();
    await assertNoWithheldEntityIsServed(`The detail route for ${entity.slug}`);
  }
});

await step('a contact-bearing row renders with its contact details withheld', async () => {
  await page.goto(`${baseUrl}/research/${SMOKE_CONTACT_ENTITY_SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
  await settleResearchPage();
  await page
    .getByRole('heading', { level: 1, name: SMOKE_CONTACT_ENTITY_NAME })
    .waitFor({ timeout: 20000 });
  await assertTextIncludes('vocalizations');
  const text = await bodyText();
  const html = await page.content();
  for (const detail of SMOKE_CONTACT_DETAILS) {
    assert(
      !text.includes(detail) && !html.includes(detail),
      `The detail page served a stored contact detail (${detail}) unredacted.`,
    );
  }
});

await step('the student returns to the detail page the journey continues from', async () => {
  await page.goto(`${baseUrl}/research/${SMOKE_ENTITY_SLUG}`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page
    .getByRole('heading', { level: 1, name: SMOKE_ENTITY_NAME })
    .waitFor({ timeout: 20000 });
});

const UNBROKEN_NAME_TOKEN = 'Quokkasynthetictoken'.repeat(6);
const UNBROKEN_URL_TOKEN = `https://example.test/${'quokkapath'.repeat(10)}`;

const injectUnbrokenTokens = (entity) => {
  if (!entity || typeof entity !== 'object') return;
  entity.name = `${entity.name || ''} ${UNBROKEN_NAME_TOKEN}`;
  for (const field of ['shortDescription', 'fullDescription', 'blurb']) {
    if (typeof entity[field] === 'string') {
      entity[field] = `${UNBROKEN_NAME_TOKEN} ${UNBROKEN_URL_TOKEN} ${entity[field]}`;
    }
  }
  if (typeof entity.cardDescription?.text === 'string') {
    entity.cardDescription.text = `${UNBROKEN_NAME_TOKEN} ${entity.cardDescription.text}`;
  }
  if (entity.websiteUrl) entity.websiteUrl = UNBROKEN_URL_TOKEN;
};

await step('a long unbroken name or URL never scrolls a 320px page sideways', async () => {
  const phonePage = await context.newPage();
  try {
    await phonePage.setViewportSize({ width: 320, height: 800 });
    await phonePage.route(/\/api\/research\/(search|[^/?]+)(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => null);
      if (!body) return route.fulfill({ response });
      (body.researchEntities || []).forEach(injectUnbrokenTokens);
      injectUnbrokenTokens(body.researchEntity);
      for (const rail of [
        'relatedResearchEntities',
        'affiliatedResearchEntities',
        'similarResearchEntities',
      ]) {
        (body[rail] || []).forEach(injectUnbrokenTokens);
      }
      return route.fulfill({ response, json: body });
    });
    const assertNoSidewaysScroll = async (surface) => {
      const { scrollWidth, clientWidth } = await phonePage
        .locator('[data-scroll-container]')
        .evaluate((element) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }));
      assert(
        scrollWidth <= clientWidth,
        `${surface} scrolls sideways at 320px with a 120-character token: ${scrollWidth}px of content in ${clientWidth}px.`,
      );
    };
    await withFailureContextOf(phonePage, async () => {
      await phonePage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
      await settleResearchPage(phonePage);
      await phonePage.locator('article.yr-card-interactive').first().waitFor({ timeout: 20000 });
      await assertNoSidewaysScroll('Browse');
      await phonePage.goto(`${baseUrl}/research/${SMOKE_ENTITY_SLUG}`, {
        waitUntil: 'domcontentloaded',
      });
      await settleResearchPage(phonePage);
      await phonePage.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
      await assertNoSidewaysScroll('The detail page');
    });
  } finally {
    await phonePage.close();
  }
});

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
      { cause: error },
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

await step('an absolutely positioned element deep in a page never scrolls the window', async () => {
  await page.goto(`${baseUrl}/about`, { waitUntil: 'domcontentloaded' });
  await settleResearchPage();
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
  const { documentHeight, viewportHeight } = await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = `${window.innerHeight * 3}px`;
    const card = document.createElement('div');
    card.className = 'overflow-hidden';
    const text = document.createElement('p');
    text.textContent = 'smoke probe';
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = 'smoke probe label';
    text.append(label);
    card.append(text);
    const probe = document.createElement('div');
    probe.append(spacer, card);
    document.querySelector('main')?.append(probe);
    const measured = {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    };
    probe.remove();
    return measured;
  });
  assert(
    documentHeight <= viewportHeight,
    `An sr-only element at the bottom of a page stretched the document to ${documentHeight}px in a ${viewportHeight}px window, so the window scrolls the app shell out of view.`,
  );
});

await step(
  'shift-tabbing back through results never parks focus under the sticky filter bar',
  async () => {
    const narrowPage = await context.newPage();
    try {
      await narrowPage.setViewportSize({ width: 640, height: 400 });
      await narrowPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
      await settleResearchPage(narrowPage);
      await narrowPage
        .getByRole('link', { name: SMOKE_ENTITY_NAME })
        .first()
        .waitFor({ timeout: 20000 });
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
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
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
  },
);

const LAYOUT_SHIFT_BUDGET = 0.1;
const syntheticLayoutEntity = (index) => ({
  _id: `e2e-layout-${index}`,
  slug: `e2e-layout-fixture-${index}`,
  name: `Layout Fixture ${index}`,
  displayName: `Layout Fixture ${index}`,
  kind: 'lab',
  fullDescription: 'Synthetic research entity for the layout stability smoke.',
  departments: ['Computer Science'],
  researchAreas: ['Testing'],
  sourceUrls: [],
});
const syntheticAdminSession = {
  auth: true,
  user: { netId: 'e2eop1', userType: 'undergraduate', userConfirmed: true, isAdmin: true },
};

const SIGNED_IN_NOTICE = /You're signed in/;
const USER_MENU_LABEL = 'Open user menu';
const ADMIN_CONTROL_LABEL = 'Show weakest profiles first';

const syntheticStudentSession = {
  auth: true,
  user: { netId: 'e2est1', userType: 'undergraduate', userConfirmed: true, isAdmin: false },
};

const assertLateSessionKeepsBrowseStable = async (viewport, session) => {
  const persona = session.user.isAdmin ? 'an admin' : 'a signed-in student';
  const shiftContext = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  let releaseSessionCheck;
  const sessionCheckReleased = new Promise((resolve) => {
    releaseSessionCheck = resolve;
  });
  try {
    await shiftContext.route(/google-analytics|googletagmanager/, (route) => route.abort());
    await shiftContext.route('**/api/check', async (route) => {
      await sessionCheckReleased;
      await route.fulfill({ json: session });
    });
    await shiftContext.route('**/api/research/search', (route) =>
      route.fulfill({
        json: {
          researchEntities: Array.from({ length: 12 }, (_, index) => syntheticLayoutEntity(index)),
          estimatedTotalHits: 12,
          page: 1,
          pageSize: 24,
          facetDistribution: {},
        },
      }),
    );
    await shiftContext.route('**/api/users/**', (route) =>
      route.fulfill({ json: { watchedPrograms: [], watchedProgramPlans: {} } }),
    );
    await shiftContext.route('**/api/analytics/**', (route) => route.fulfill({ status: 204 }));
    const shiftPage = await shiftContext.newPage();
    await withFailureContextOf(shiftPage, async () => {
      await shiftPage.addInitScript(() => {
        window.__layoutShifts = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            window.__layoutShifts.push({
              startTime: entry.startTime,
              value: entry.value,
              sources: entry.sources.map((source) => {
                const node = source.node;
                const label = node?.getAttribute?.('aria-label') || node?.tagName?.toLowerCase();
                return `${label ?? 'node'} moved ${Math.round(source.currentRect.y - source.previousRect.y)}px`;
              }),
            });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await shiftPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
      await shiftPage
        .getByRole('link', { name: 'Layout Fixture 0' })
        .first()
        .waitFor({ timeout: 20000 });
      await shiftPage.waitForTimeout(1000);
      assert(
        !(await shiftPage.getByText(SIGNED_IN_NOTICE).isVisible()) &&
          (await shiftPage.getByRole('button', { name: USER_MENU_LABEL }).count()) === 0 &&
          (await shiftPage.getByLabel(ADMIN_CONTROL_LABEL).count()) === 0,
        'Signed-in UI rendered before the held session check was answered, so this case cannot measure a late session.',
      );
      const sessionAnsweredAt = await shiftPage.evaluate(() => performance.now());
      releaseSessionCheck();
      await shiftPage
        .getByText(SIGNED_IN_NOTICE)
        .or(shiftPage.getByRole('button', { name: USER_MENU_LABEL }))
        .first()
        .waitFor({ state: 'visible', timeout: 20000 });
      await shiftPage.waitForTimeout(1000);
      const shifts = await shiftPage.evaluate(
        (since) => window.__layoutShifts.filter((shift) => shift.startTime >= since),
        sessionAnsweredAt,
      );
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      const largest = shifts.reduce(
        (max, shift) => (!max || shift.value > max.value ? shift : max),
        null,
      );
      record('browse layout shift with a late session', {
        persona,
        width: viewport.width,
        cumulativeLayoutShift: Number(total.toFixed(4)),
      });
      assert(
        total < LAYOUT_SHIFT_BUDGET,
        `Browse at ${viewport.width}px shifted by ${total.toFixed(3)} (budget ${LAYOUT_SHIFT_BUDGET}) once a late session check answered for ${persona}; largest shift ${largest?.value.toFixed(3)}: ${largest?.sources.join(', ')}.`,
      );
      if (session.user.isAdmin) {
        const adminControl = shiftPage.getByLabel(ADMIN_CONTROL_LABEL);
        if (!(await adminControl.isVisible())) {
          await shiftPage
            .getByRole('button', { name: /^Filters/ })
            .first()
            .click();
        }
        await adminControl.waitFor({ state: 'visible', timeout: 20000 });
      }
    });
  } finally {
    releaseSessionCheck();
    await shiftContext.close();
  }
};

await step('a session answering late does not shift the browse page', async () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 375, height: 900 },
  ]) {
    await assertLateSessionKeepsBrowseStable(viewport, syntheticAdminSession);
    await assertLateSessionKeepsBrowseStable(viewport, syntheticStudentSession);
  }
});

const syntheticProgram = (index) => ({
  _id: `e2e-program-${index}`,
  title: `Program Fixture ${index}`,
  summary: 'Synthetic program for the overlay smoke.',
  description: 'Synthetic program description for the overlay smoke. '.repeat(6),
  programCategory: 'FELLOWSHIP',
  programKind: 'RESEARCH_FUNDING',
  isAcceptingApplications: index % 2 === 0,
  deadline: new Date(Date.now() + (index + 3) * 86400000).toISOString(),
  yearOfStudy: ['Junior'],
  purpose: ['Research'],
});

const withSyntheticBrowsePage = async (viewport, fn, { reducedMotion = 'no-preference' } = {}) => {
  const syntheticContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion,
  });
  try {
    await syntheticContext.route(/google-analytics|googletagmanager/, (route) => route.abort());
    await syntheticContext.route('**/api/check', (route) =>
      route.fulfill({ json: syntheticStudentSession }),
    );
    await syntheticContext.route('**/api/research/search**', (route) =>
      route.fulfill({
        json: {
          researchEntities: Array.from({ length: 6 }, (_, index) => syntheticLayoutEntity(index)),
          estimatedTotalHits: 6,
          page: 1,
          pageSize: 24,
          facetDistribution: {},
        },
      }),
    );
    await syntheticContext.route('**/api/programs/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith('/programs/filters')) {
        return route.fulfill({ json: { yearOfStudy: ['Junior'], purpose: ['Research'] } });
      }
      if (pathname.endsWith('/programs/search')) {
        const results = Array.from({ length: 6 }, (_, index) => syntheticProgram(index));
        return route.fulfill({ json: { results, total: results.length } });
      }
      return route.fulfill({ json: { program: syntheticProgram(1) } });
    });
    await syntheticContext.route('**/api/fellowships/**', (route) => route.fulfill({ json: {} }));
    await syntheticContext.route('**/api/users/**', (route) =>
      route.fulfill({ json: { watchedPrograms: [], watchedProgramPlans: {} } }),
    );
    await syntheticContext.route('**/api/analytics/**', (route) => route.fulfill({ status: 204 }));
    const syntheticPage = await syntheticContext.newPage();
    await withFailureContextOf(syntheticPage, () => fn(syntheticPage));
  } finally {
    await syntheticContext.close();
  }
};

const FOOTER_SHIFT_BUDGET = 0.001;

await step('a lazy route keeps the footer below the fold while it loads', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    for (const route of ['/about', '/programs']) {
      await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
        await syntheticPage.addInitScript(() => {
          window.__pageShift = 0;
          window.__footerSourcedShifts = [];
          window.__footerSamples = [];
          const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
          const isFooterSource = (source) => Boolean(elementOf(source.node)?.closest?.('footer'));
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.hadRecentInput) continue;
              window.__pageShift += entry.value;
              if (entry.sources.some(isFooterSource)) {
                window.__footerSourcedShifts.push({
                  startTime: entry.startTime,
                  value: entry.value,
                });
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
          const sampleFooter = (time) => {
            const footer = document.querySelector('footer');
            if (footer)
              window.__footerSamples.push({ time, top: footer.getBoundingClientRect().top });
            requestAnimationFrame(sampleFooter);
          };
          requestAnimationFrame(sampleFooter);
        });
        await syntheticPage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        await syntheticPage.waitForTimeout(2500);
        const { footerShift, pageShift, footerSamples, highestFooterTop } =
          await syntheticPage.evaluate(() => {
            const samples = window.__footerSamples;
            // Chrome reports an on-screen previousRect for the footer wordmark's transformed slash
            // while the footer is still below the fold, so visibility comes from the sampled footer.
            const footerOnScreenAround = ({ startTime }) => {
              const shiftFrame = samples.findLastIndex((sample) => sample.time <= startTime);
              return samples
                .slice(Math.max(0, shiftFrame - 1), shiftFrame + 2)
                .some((sample) => sample.top < window.innerHeight);
            };
            return {
              footerShift: window.__footerSourcedShifts
                .filter(footerOnScreenAround)
                .reduce((sum, shift) => sum + shift.value, 0),
              pageShift: window.__pageShift,
              footerSamples: samples.length,
              highestFooterTop: Math.min(...samples.map((sample) => sample.top)),
            };
          });
        assert(
          footerSamples > 0,
          `No footer rendered on ${route} at ${viewport.width}px, so its position could not be measured.`,
        );
        record('lazy route footer stability', {
          route,
          width: viewport.width,
          footerShift: Number(footerShift.toFixed(4)),
          cumulativeLayoutShift: Number(pageShift.toFixed(4)),
          highestFooterTop: Math.round(highestFooterTop),
        });
        assert(
          highestFooterTop >= viewport.height,
          `The footer on ${route} at ${viewport.width}px painted ${Math.round(highestFooterTop)}px from the top of a ${viewport.height}px viewport while the route loaded.`,
        );
        assert(
          footerShift < FOOTER_SHIFT_BUDGET,
          `The footer on ${route} at ${viewport.width}px shifted by ${footerShift.toFixed(3)} while the route loaded.`,
        );
        assert(
          route !== '/about' || pageShift < LAYOUT_SHIFT_BUDGET,
          `${route} at ${viewport.width}px shifted by ${pageShift.toFixed(3)} on load (budget ${LAYOUT_SHIFT_BUDGET}).`,
        );
      });
    }
  }
});

const backgroundOf = async (targetPage, selector) => {
  const element = targetPage.locator(selector).first();
  await element.waitFor({ timeout: 5000 }).catch(() => undefined);
  if ((await element.count()) === 0) return 'no backdrop';
  return element.evaluate((node) => getComputedStyle(node).backgroundColor);
};

const overlayScrimOf = (targetPage) =>
  targetPage
    .getByRole('dialog')
    .first()
    .evaluate((dialog) => {
      let element = dialog;
      while (element && getComputedStyle(element).position !== 'fixed')
        element = element.parentElement;
      return element ? getComputedStyle(element).backgroundColor : 'no fixed overlay';
    });

const scrimAlpha = (color) => {
  const slashAlpha = /\/\s*([\d.]+)\s*\)$/.exec(color);
  if (slashAlpha) return Number(slashAlpha[1]);
  const rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(color);
  if (rgba) return Number(rgba[1]);
  return /^rgb\(/.test(color) ? 1 : 0;
};

await step('every overlay dims the page with the one navy scrim', async () => {
  const mobile = { width: 375, height: 812 };
  const scrims = {};
  await withSyntheticBrowsePage(mobile, async (syntheticPage) => {
    await syntheticPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
    await syntheticPage
      .getByRole('button', { name: /^Filters/ })
      .first()
      .click();
    scrims['research filter sheet'] = await backgroundOf(
      syntheticPage,
      '[data-testid="research-filter-backdrop"]',
    );
  });
  await withSyntheticBrowsePage(mobile, async (syntheticPage) => {
    await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
    await syntheticPage
      .getByRole('button', { name: /^Filters/ })
      .first()
      .click();
    scrims['program filter sheet'] = await backgroundOf(
      syntheticPage,
      '[data-testid="filter-sheet-backdrop"]',
    );
  });
  await withSyntheticBrowsePage(mobile, async (syntheticPage) => {
    await syntheticPage.goto(`${baseUrl}/research`, { waitUntil: 'domcontentloaded' });
    await syntheticPage.getByRole('button', { name: 'Open menu' }).first().click();
    scrims['navigation menu'] = await backgroundOf(
      syntheticPage,
      '.MuiDrawer-root .MuiBackdrop-root',
    );
  });
  for (const viewport of [mobile, { width: 1440, height: 900 }]) {
    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      await syntheticPage.goto(`${baseUrl}/programs?program=e2e-program-1`, {
        waitUntil: 'domcontentloaded',
      });
      await syntheticPage.getByRole('dialog').first().waitFor({ timeout: 20000 });
      scrims[`program modal at ${viewport.width}px`] = await overlayScrimOf(syntheticPage);
    });
  }
  record('overlay scrims', scrims);
  const reference = scrims['research filter sheet'];
  assert(
    scrimAlpha(reference) > 0,
    `The research filter sheet backdrop is ${reference}, so the page behind the sheet is not dimmed.`,
  );
  for (const [overlay, color] of Object.entries(scrims)) {
    assert(
      color === reference,
      `The ${overlay} scrim is ${color}, not the shared navy scrim ${reference}.`,
    );
    assert(
      !/^rgba?\(0, 0, 0[,)]/.test(color),
      `The ${overlay} scrim is untinted black (${color}).`,
    );
  }
});

const DIALOG_SHIFT_BUDGET = 0.01;
const DIALOG_TOP_TOLERANCE = 16;

const assertDeepLinkedProgramDialogRendersInPlace = async (viewport, reducedMotion) => {
  await withSyntheticBrowsePage(
    viewport,
    async (syntheticPage) => {
      await syntheticPage.addInitScript(() => {
        window.__dialogShifts = [];
        window.__dialogTops = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            if (!entry.sources.some((source) => source.node?.closest?.('[role="dialog"]')))
              continue;
            window.__dialogShifts.push(entry.value);
          }
        }).observe({ type: 'layout-shift', buffered: true });
        const sampleDialogTop = () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) window.__dialogTops.push(dialog.getBoundingClientRect().top);
          requestAnimationFrame(sampleDialogTop);
        };
        requestAnimationFrame(sampleDialogTop);
      });
      await syntheticPage.goto(`${baseUrl}/programs?program=e2e-program-1`, {
        waitUntil: 'domcontentloaded',
      });
      await syntheticPage.getByRole('dialog').first().waitFor({ timeout: 20000 });
      await syntheticPage.waitForTimeout(2000);
      const { shift, maxTop, finalTop } = await syntheticPage.evaluate(() => ({
        shift: window.__dialogShifts.reduce((sum, value) => sum + value, 0),
        maxTop: Math.max(...window.__dialogTops),
        finalTop: window.__dialogTops[window.__dialogTops.length - 1],
      }));
      record('deep-linked program dialog stability', {
        width: viewport.width,
        reducedMotion,
        dialogLayoutShift: Number(shift.toFixed(4)),
        maxTop: Math.round(maxTop),
        finalTop: Math.round(finalTop),
      });
      assert(
        maxTop - finalTop <= DIALOG_TOP_TOLERANCE,
        `A deep-linked program dialog at ${viewport.width}px first painted ${Math.round(maxTop)}px from the top and settled at ${Math.round(finalTop)}px, so it jumped into place.`,
      );
      assert(
        shift < DIALOG_SHIFT_BUDGET,
        `A deep-linked program dialog at ${viewport.width}px shifted by ${shift.toFixed(3)} (budget ${DIALOG_SHIFT_BUDGET}).`,
      );
    },
    { reducedMotion },
  );
};

await step('a deep-linked program dialog renders in place without a layout shift', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await assertDeepLinkedProgramDialogRendersInPlace(viewport, 'no-preference');
  }
  await assertDeepLinkedProgramDialogRendersInPlace({ width: 768, height: 1024 }, 'reduce');
});

const QUICK_FILTER_MAX_ROWS = 3;
const QUICK_FILTER_COUNT_TOLERANCE = 8;

await step('the program quick filters fit their rail panel with the count in view', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
      const group = syntheticPage.getByRole('group', { name: 'Quick filters' });
      await group.waitFor({ timeout: 20000 });
      await syntheticPage
        .getByRole('status')
        .filter({ hasText: /^\d+ results?$/ })
        .first()
        .waitFor({ timeout: 20000 });
      const bar = await group.evaluate((element) => {
        const panel = element.parentElement;
        const search = document.getElementById('program-search')?.closest('.yr-panel');
        const chipTops = [...element.querySelectorAll('button')].map((button) =>
          Math.round(button.getBoundingClientRect().top),
        );
        const count = panel.querySelector('[role="status"]');
        const panelStyle = getComputedStyle(panel);
        return {
          radius: parseFloat(panelStyle.borderTopLeftRadius),
          searchRadius: search ? parseFloat(getComputedStyle(search).borderTopLeftRadius) : null,
          paddingLeft: panelStyle.paddingLeft,
          searchPaddingLeft: search ? getComputedStyle(search).paddingLeft : null,
          chips: chipTops.length,
          rows: new Set(chipTops).size,
          firstRowTop: Math.min(...chipTops),
          countTop: count ? Math.round(count.getBoundingClientRect().top) : null,
          height: Math.round(panel.getBoundingClientRect().height),
        };
      });
      record('program quick filter rail', { width: viewport.width, ...bar });
      assert(
        bar.chips === 7,
        `The rail drew ${bar.chips} quick filters at ${viewport.width}px, not 7.`,
      );
      assert(
        bar.radius > 0 && bar.radius === bar.searchRadius,
        `The quick filter rail at ${viewport.width}px has a ${bar.radius}px radius under a ${bar.searchRadius}px search panel.`,
      );
      assert(
        bar.paddingLeft === bar.searchPaddingLeft,
        `The quick filter rail at ${viewport.width}px is padded ${bar.paddingLeft}, the search panel ${bar.searchPaddingLeft}.`,
      );
      assert(
        bar.rows <= QUICK_FILTER_MAX_ROWS,
        `The quick filters wrap to ${bar.rows} rows at ${viewport.width}px (at most ${QUICK_FILTER_MAX_ROWS}).`,
      );
      assert(
        bar.countTop !== null && bar.countTop <= bar.firstRowTop + QUICK_FILTER_COUNT_TOLERANCE,
        `The result count at ${viewport.width}px sits ${bar.countTop === null ? 'nowhere' : `${bar.countTop - bar.firstRowTop}px below the first quick filter row`}, so it floats away from the filters it counts.`,
      );
    });
  }
});

const PROGRAMS_LOAD_ERROR_COPY = 'Could not load programs and fellowships';
const PROGRAMS_SETTLE_MS = 2500;
const PROGRAMS_ERROR_LATENCY_MS = 300;

const isFirstPageProgramSearch = (request) => {
  const url = new URL(request.url());
  return url.pathname.endsWith('/programs/search') && url.searchParams.get('page') === '1';
};

await step('a programs visit sends one search and keeps a failed load an error', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      let searches = 0;
      syntheticPage.on('request', (request) => {
        if (isFirstPageProgramSearch(request)) searches += 1;
      });
      await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
      await syntheticPage.waitForTimeout(PROGRAMS_SETTLE_MS);
      record('program first-page searches per visit', { width: viewport.width, searches });
      assert(
        searches === 1,
        `One /programs visit at ${viewport.width}px sent ${searches} identical first-page searches, not 1.`,
      );
    });

    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      let searches = 0;
      await syntheticPage.route('**/api/programs/search**', async (route) => {
        searches += 1;
        await new Promise((resolve) => setTimeout(resolve, PROGRAMS_ERROR_LATENCY_MS));
        await route.fulfill({ status: 500, json: { error: 'synthetic failure' } });
      });
      await syntheticPage.addInitScript((errorCopy) => {
        window.__programErrorFrames = [];
        window.__programContentShift = 0;
        const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            const movesOnlyFooter = entry.sources.every((source) =>
              elementOf(source.node)?.closest?.('footer'),
            );
            if (!movesOnlyFooter) window.__programContentShift += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        const sample = () => {
          window.__programErrorFrames.push((document.body?.innerText || '').includes(errorCopy));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, PROGRAMS_LOAD_ERROR_COPY);
      await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
      await syntheticPage.waitForTimeout(PROGRAMS_SETTLE_MS);
      const { frames, contentShift } = await syntheticPage.evaluate(() => ({
        frames: window.__programErrorFrames,
        contentShift: window.__programContentShift,
      }));
      const firstErrorFrame = frames.indexOf(true);
      const framesWithoutErrorAfterIt =
        firstErrorFrame < 0 ? 0 : frames.slice(firstErrorFrame).filter((shown) => !shown).length;
      record('program load error stability', {
        width: viewport.width,
        searches,
        firstErrorFrame,
        framesWithoutErrorAfterIt,
        contentLayoutShift: Number(contentShift.toFixed(4)),
      });
      assert(
        firstErrorFrame >= 0,
        `A failing programs search at ${viewport.width}px never showed "${PROGRAMS_LOAD_ERROR_COPY}".`,
      );
      assert(
        framesWithoutErrorAfterIt === 0,
        `The programs load error at ${viewport.width}px disappeared for ${framesWithoutErrorAfterIt} frames with no input from the student.`,
      );
      assert(
        searches === 1,
        `A failing programs search at ${viewport.width}px was sent ${searches} times without a retry.`,
      );
      assert(
        contentShift < LAYOUT_SHIFT_BUDGET,
        `A failing programs load at ${viewport.width}px shifted the page by ${contentShift.toFixed(3)} (budget ${LAYOUT_SHIFT_BUDGET}).`,
      );
    });
  }
});

const PROGRAMS_LOADED_SHIFT_BUDGET = 0.01;

await step('a successful programs load keeps its layout when the data arrives', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      let releaseSearch;
      const searchReleased = new Promise((resolve) => {
        releaseSearch = resolve;
      });
      await syntheticPage.route('**/api/programs/search**', async (route) => {
        await searchReleased;
        const results = [
          ...Array.from({ length: 6 }, (_, index) => ({
            ...syntheticProgram(index),
            programKind: 'FELLOWSHIP_FUNDING',
          })),
          { ...syntheticProgram(6), departmentResearchGuidance: true },
          { ...syntheticProgram(7), studentFacingCategory: 'Archive / review' },
        ];
        await route.fulfill({ json: { results, total: results.length } });
      });
      await syntheticPage.addInitScript(() => {
        window.__programLoadShifts = [];
        const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            const movesOnlyFooter = entry.sources.every((source) =>
              elementOf(source.node)?.closest?.('footer'),
            );
            if (movesOnlyFooter) continue;
            window.__programLoadShifts.push({
              startTime: entry.startTime,
              value: entry.value,
              sources: entry.sources.map((source) => {
                const element = elementOf(source.node);
                return element
                  ? `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`
                  : 'unknown';
              }),
            });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
      await syntheticPage
        .locator('dl')
        .getByText('Loading')
        .first()
        .waitFor({ state: 'attached', timeout: 20000 });
      const releasedAt = await syntheticPage.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now();
      });
      releaseSearch();
      await syntheticPage.getByText('Program Fixture 0').first().waitFor({ timeout: 20000 });
      await syntheticPage.waitForTimeout(PROGRAMS_SETTLE_MS);
      const shifts = await syntheticPage.evaluate(
        (since) => window.__programLoadShifts.filter((shift) => shift.startTime >= since),
        releasedAt,
      );
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      const largest = [...shifts].sort((a, b) => b.value - a.value)[0];
      record('program successful load layout shift', {
        width: viewport.width,
        contentLayoutShift: Number(total.toFixed(4)),
        largestShiftSources: largest?.sources ?? [],
      });
      assert(
        total < PROGRAMS_LOADED_SHIFT_BUDGET,
        `A successful programs load at ${viewport.width}px shifted the page by ${total.toFixed(3)} once the data arrived (budget ${PROGRAMS_LOADED_SHIFT_BUDGET}); largest shift ${largest?.value.toFixed(3)}: ${largest?.sources.join(', ')}.`,
      );
    });
  }
});

const INTERNAL_PROGRAM_FACET_NAMES = [
  'Journey',
  'Program Kind',
  'Entry Mode',
  'Legacy Type',
  'Legacy category',
];
const TAB_EDGE_TOLERANCE = 1;

await step('a student sees only student-worded program filter tabs, all in view', async () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await withSyntheticBrowsePage(viewport, async (syntheticPage) => {
      await syntheticPage.goto(`${baseUrl}/programs`, { waitUntil: 'domcontentloaded' });
      await syntheticPage
        .getByRole('button', { name: /^Filters/ })
        .first()
        .click();
      const dialog = syntheticPage.getByRole('dialog', { name: 'Program filters' });
      await dialog.waitFor({ timeout: 20000 });
      const { tabs, dialogBox } = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const strip = [...element.querySelectorAll('button[aria-pressed]')];
        return {
          dialogBox: { left: box.left, right: box.right },
          tabs: strip.map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { name: tab.textContent.trim(), left: rect.left, right: rect.right };
          }),
        };
      });
      record('program filter tabs', {
        width: viewport.width,
        tabs: tabs.map((tab) => tab.name),
      });
      const internal = tabs.filter((tab) => INTERNAL_PROGRAM_FACET_NAMES.includes(tab.name));
      assert(
        internal.length === 0,
        `A student at ${viewport.width}px sees internal program facet tabs: ${internal.map((tab) => tab.name).join(', ')}.`,
      );
      const clipped = tabs.filter(
        (tab) =>
          tab.left < dialogBox.left - TAB_EDGE_TOLERANCE ||
          tab.right > dialogBox.right + TAB_EDGE_TOLERANCE,
      );
      assert(
        tabs.length > 0 && clipped.length === 0,
        `The program filter tabs at ${viewport.width}px run past the popover edge: ${clipped.map((tab) => tab.name).join(', ')}.`,
      );
    });
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
