/**
 * Browser smoke for the serve-time half of #3027.
 *
 * A merged identity is kept as an archived `research_entities` row carrying a
 * `canonicalGroupId` tombstone, which is what stops a re-scrape re-minting the
 * duplicate. This asserts what a student actually gets from that row: the shell's own
 * name and copy are never rendered, and its slug resolves onward to the survivor
 * rather than dead-ending.
 *
 * Measured rather than assumed: the shell's API route answers 302 to the survivor's
 * path, not 404. `getResearchGroupDetail` returns null for an archived row and the
 * controller then resolves the tombstone chain and redirects, so the old URL keeps
 * working. An earlier draft of this test asserted a 4xx and was wrong.
 *
 * The shell is seeded at `student_ready` on purpose. If the page were withheld
 * because its tier was unservable, this test would pass while the archived check it
 * exists to cover was broken.
 *
 * Usage: E2E_BASE_URL=http://localhost:4000 node scripts/e2e-merge-tombstone-smoke.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEPLOYED_HOSTS = new Set([
  'yalelabs.io',
  'www.yalelabs.io',
  'yalelabs.onrender.com',
  'ylabs-gr4v.onrender.com',
]);

const MERGED_SHELL_SLUG = 'e2e-smoke-merged-shell-quokka-research';
const SURVIVOR_SLUG = 'e2e-smoke-quokka-cognition-lab';
const SURVIVOR_NAME = 'Quokka Cognition Lab';
const SHELL_NAME = 'Quokka Research Area';
const SHELL_COPY = 'Superseded record folded into the Quokka Cognition Lab.';

const isInsidePath = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

const safeBaseUrl = (raw, name) => {
  const value = String(raw || '').trim();
  if (!value || value.length > 2048) throw new Error(`${name} must be a bounded URL`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP(S)`);
  }
  if (parsed.username || parsed.password) throw new Error(`${name} must not include credentials`);
  if (parsed.search || parsed.hash) throw new Error(`${name} must not include query or fragment`);
  const hostname = parsed.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.has(hostname);
  const isDeployed = DEPLOYED_HOSTS.has(hostname);
  if (!isLocal && !isDeployed) {
    throw new Error(`${name} must point to localhost or a y/labs deployment`);
  }
  if (isDeployed && parsed.protocol !== 'https:') {
    throw new Error(`${name} deployed origins must use HTTPS`);
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/g, '')}`;
};

const safeOutputDir = (raw) => {
  const value = String(raw || 'tmp/e2e-merge-tombstone-smoke').trim();
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('OUT_DIR must be a bounded path');
  }
  const resolved = path.resolve(value);
  if (!isInsidePath(path.resolve('tmp'), resolved) && !isInsidePath(path.resolve('/tmp'), resolved)) {
    throw new Error('OUT_DIR must stay under repo tmp/ or /tmp');
  }
  return resolved;
};

const baseUrl = safeBaseUrl(process.env.E2E_BASE_URL || 'http://localhost:4000', 'E2E_BASE_URL');
const outDir = safeOutputDir(process.env.OUT_DIR);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await context.newPage();
const failures = [];
const steps = [];

const record = (name, details = {}) => steps.push({ name, ...details });
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const bodyText = async () =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

const screenshot = async (name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  record('screenshot', { file });
};

const settle = async () => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
};

const step = async (name, fn) => {
  try {
    await fn();
    record(name, { status: 'pass' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let preview = '';
    let url = '';
    try {
      url = page.url();
      preview = (await bodyText()).slice(0, 600);
    } catch {
      /* the page may be closed */
    }
    failures.push({ name, message, url, preview });
    record(name, { status: 'fail', message, url, preview });
  }
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

// The research surfaces need a session, the same way the student-journey smoke does.
const login = async () => {
  const deadline = Date.now() + 45000;
  let state = { status: 0, auth: false };
  while (Date.now() < deadline) {
    await page
      .goto(`${baseUrl}/api/dev-login?redirect=/research`, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);
    await settle();
    state = await readAuthState();
    if (state.auth) return;
    await page.waitForTimeout(2000);
  }
  assert(
    state.auth,
    `dev-login never established a session in 45s (GET /api/check -> ${JSON.stringify(state)}).`,
  );
};

await step('a signed-in student reaches the research surfaces', async () => {
  await login();
});

await step('the merge survivor serves its own detail page', async () => {
  const response = await page.goto(`${baseUrl}/research/${SURVIVOR_SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
  await settle();
  assert(
    !response || response.status() < 400,
    `Survivor page returned HTTP ${response?.status()}.`,
  );
  const text = await bodyText();
  assert(text.includes(SURVIVOR_NAME), `Survivor page did not render "${SURVIVOR_NAME}".`);
  await screenshot('survivor-detail');
});

await step('the merged shell never renders its own name or copy', async () => {
  await page.goto(`${baseUrl}/research/${MERGED_SHELL_SLUG}`, { waitUntil: 'domcontentloaded' });
  await settle();
  const text = await bodyText();
  assert(
    !text.includes(SHELL_COPY),
    'The merged shell rendered its own stored description to a student.',
  );
  assert(
    !text.includes(SHELL_NAME),
    `The merged shell rendered its own name "${SHELL_NAME}" to a student.`,
  );
  await screenshot('merged-shell-withheld');
});

await step('the merged shell is absent from search results', async () => {
  await page.goto(`${baseUrl}/research?q=quokka`, { waitUntil: 'domcontentloaded' });
  await settle();
  const text = await bodyText();
  assert(text.includes(SURVIVOR_NAME), 'Search did not surface the surviving lab.');
  assert(!text.includes(SHELL_NAME), 'Search surfaced the merged shell.');
  await screenshot('search-excludes-shell');
});

await step('the detail API resolves the merged shell onward to the survivor', async () => {
  const result = await page.evaluate(
    async ([origin, shell, survivor]) => {
      // A browser fetch cannot read a 302 directly: `redirect: 'manual'` yields an
      // opaque response with status 0 and no headers. Follow it and read the final
      // URL instead, which is what proves where the tombstone sent the request.
      const read = async (slug) => {
        const response = await fetch(`${origin}/api/research/${slug}`, {
          headers: { accept: 'application/json' },
        });
        return {
          status: response.status,
          finalUrl: response.url,
          redirected: response.redirected,
          body: (await response.text()).slice(0, 400),
        };
      };
      return { shell: await read(shell), survivor: await read(survivor) };
    },
    [baseUrl, MERGED_SHELL_SLUG, SURVIVOR_SLUG],
  );
  record('api', result);

  assert(result.survivor.status === 200, `Survivor API returned HTTP ${result.survivor.status}.`);
  assert(!result.survivor.redirected, 'A live survivor should not be redirected anywhere.');

  // The tombstone is what makes this a redirect rather than a dead end.
  assert(result.shell.redirected, 'Merged shell was not redirected at all.');
  assert(
    result.shell.finalUrl.endsWith(`/api/research/${SURVIVOR_SLUG}`),
    `Merged shell resolved to "${result.shell.finalUrl}" instead of the survivor.`,
  );
  assert(
    result.shell.status === 200,
    `Following the merged shell redirect returned HTTP ${result.shell.status}.`,
  );
  assert(
    !result.shell.body.includes(SHELL_COPY),
    'Merged shell API leaked its stored description.',
  );
});

await context.close();
await browser.close();

const report = { baseUrl, outDir, failures, steps };
await fs.writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error(`merge-tombstone smoke failed ${failures.length} step(s)`);
  process.exit(1);
}
console.log('merge-tombstone smoke passed');
