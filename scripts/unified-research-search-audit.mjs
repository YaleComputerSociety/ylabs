import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const clientBase = process.env.CLIENT_BASE || 'http://localhost:3000';
const serverBase = process.env.SERVER_BASE || 'http://localhost:4000';
const outDir = process.env.OUT_DIR || 'tmp/unified-research-search-audit';

const researchQuery = process.env.RESEARCH_QUERY || 'machine learning';
const mobileQuery = process.env.MOBILE_QUERY || 'archival research';

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const failures = [];
const artifacts = [];

const record = (name, details = {}) => artifacts.push({ name, ...details });

const screenshot = async (name, targetPage = page) => {
  const file = path.join(outDir, `${name}.png`);
  await targetPage.screenshot({ path: file, fullPage: true });
  record('screenshot', { file });
};

const bodyText = async (targetPage = page) =>
  targetPage.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

const audit = async (name, fn) => {
  try {
    await fn();
    record(name, { status: 'pass' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    record(name, { status: 'fail', message });
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertTextIncludes = async (expected, targetPage = page) => {
  const text = await bodyText(targetPage);
  assert(text.includes(expected), `Expected page text to include "${expected}".`);
};

const assertTextExcludes = async (forbidden, targetPage = page) => {
  const text = await bodyText(targetPage);
  assert(!text.includes(forbidden), `Expected page text not to include "${forbidden}".`);
};

const assertTextMatches = async (pattern, targetPage = page) => {
  const text = await bodyText(targetPage);
  assert(pattern.test(text), `Expected page text to match ${pattern}.`);
};

const countTextOccurrences = async (needle, targetPage = page) => {
  const text = await bodyText(targetPage);
  return text.split(needle).length - 1;
};

const waitForResearchSettled = async (targetPage = page) => {
  await targetPage.waitForLoadState('domcontentloaded');
  await targetPage.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => undefined);
  await targetPage
    .waitForFunction(
      () =>
        !document.body.innerText.includes('Searching...') &&
        !document.body.innerText.includes('Loading pathways'),
      undefined,
      { timeout: 20000 },
    )
    .catch(() => undefined);
  await targetPage.waitForTimeout(500);
};

const login = async () => {
  await page.goto(`${serverBase}/api/dev-login`, { waitUntil: 'domcontentloaded' });
  await waitForResearchSettled();
  await page.goto(`${clientBase}/research`, { waitUntil: 'domcontentloaded' });
  await waitForResearchSettled();
};

const searchResearch = async (query) => {
  await page.goto(`${clientBase}/research`, { waitUntil: 'domcontentloaded' });
  await waitForResearchSettled();
  await page.getByLabel('Search Yale research').fill(query);
  await page.getByRole('button', { name: /^Search$/ }).click();
  await page.getByRole('heading', { name: `Results for ${query}` }).waitFor({ timeout: 20000 });
  await waitForResearchSettled();
};

const visibleLinkCount = async (name) => page.getByRole('link', { name }).count();

await login();

await audit('primary nav uses unified search', async () => {
  await assertTextIncludes('Search Research');
  await assertTextIncludes('Find Fellowships');
  await assertTextIncludes('Dashboard');
  await assertTextExcludes('Find Pathways');
  assert((await visibleLinkCount('Search Research')) > 0, 'Search Research nav link was not visible.');
  assert((await visibleLinkCount('Find Pathways')) === 0, 'Find Pathways is still in primary nav.');
});
await screenshot('01-research-initial');

await audit('research exposes action-oriented filters', async () => {
  await page.getByRole('button', { name: 'Refine search' }).click();
  await page.getByRole('button', { name: 'Open roles' }).click();
  await assertTextIncludes('1 filter active');
  await page.getByRole('button', { name: 'Paid/funded' }).click();
  await assertTextIncludes('2 filters active');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await assertTextExcludes('filter active');
});

await audit('research search renders one research-home stream', async () => {
  await searchResearch(researchQuery);
  await assertTextIncludes(`Results for ${researchQuery}`);
  await assertTextMatches(/research homes/i);
  await assertTextIncludes('Open research profile');
  await assertTextExcludes('Pathway Preview');
  await assertTextExcludes('Compare pathways');
  await assertTextExcludes('View all matching pathways');
  await assertTextExcludes('No pathways indexed yet');
});
await screenshot('02-research-search-results');

await audit('research profile CTA opens a research profile', async () => {
  const firstProfileLink = page.getByRole('link', { name: 'Open research profile' }).first();
  await firstProfileLink.click();
  await waitForResearchSettled();
  assert(
    new URL(page.url()).pathname.startsWith('/research/'),
    `Expected profile URL under /research/, got ${page.url()}.`,
  );
  await assertTextMatches(/people/i);
  await assertTextExcludes('Active Opportunities');
  assert(
    (await countTextOccurrences('Best next step:')) <= 1,
    'Research profile repeats the same best-next-step action in multiple sections.',
  );
});
await screenshot('03-research-profile');

await audit('dashboard presents one planning overview', async () => {
  await page.goto(`${clientBase}/account`, { waitUntil: 'domcontentloaded' });
  await waitForResearchSettled();
  await assertTextMatches(/your plan/i);
  await assertTextIncludes('saved pathways');
  await assertTextIncludes('saved fellowships');
  assert((await visibleLinkCount('Search Research')) > 0, 'Dashboard lacks a Search Research CTA.');
  assert((await visibleLinkCount('Find funding')) > 0, 'Dashboard lacks a funding CTA.');
});
await screenshot('04-dashboard-planning');

await audit('direct pathways route remains available as advanced filters', async () => {
  await page.goto(`${clientBase}/pathways?q=${encodeURIComponent(researchQuery)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForResearchSettled();
  await assertTextIncludes('Compare practical ways in');
  await assertTextIncludes('Pathways is for filtering action routes');
});
await screenshot('05-direct-pathways');

await audit('mobile research search has no horizontal overflow', async () => {
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const mobilePage = await mobileContext.newPage();
  try {
    await mobilePage.goto(`${serverBase}/api/dev-login`, { waitUntil: 'domcontentloaded' });
    await waitForResearchSettled(mobilePage);
    await mobilePage.goto(`${clientBase}/research?q=${encodeURIComponent(mobileQuery)}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForResearchSettled(mobilePage);
    await mobilePage.getByRole('heading', { name: `Results for ${mobileQuery}` }).waitFor({
      timeout: 20000,
    });
    await assertTextMatches(/research homes/i, mobilePage);
    await assertTextExcludes('Pathway Preview', mobilePage);
    const overflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert(overflow <= 1, `Expected no horizontal overflow on mobile, got ${overflow}px.`);
    await screenshot('06-mobile-research-results', mobilePage);
  } finally {
    await mobileContext.close();
  }
});

const summary = {
  generatedAt: new Date().toISOString(),
  clientBase,
  serverBase,
  outDir,
  failures,
  artifacts,
};

await fs.writeFile(
  path.join(outDir, 'unified-research-search-audit.json'),
  JSON.stringify(summary, null, 2),
);

await browser.close();

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
