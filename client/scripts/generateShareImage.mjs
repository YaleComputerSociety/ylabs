import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(CLIENT_ROOT, 'scripts', 'shareImage', 'template.html');
const ASSETS_DIR = join(CLIENT_ROOT, 'public', 'assets');
const INDEX_HTML_PATH = join(CLIENT_ROOT, 'index.html');
const IMAGE_BASENAME = 'og-default';
const SHARE_IMAGE_URL_PATTERN = new RegExp(
  `https://yalelabs\\.io/assets/${IMAGE_BASENAME}-[A-Za-z0-9_-]{8}\\.png`,
  'g',
);
const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 300 * 1024;

const assertInterLoaded = async (page) => {
  const loadedWeights = await page.evaluate(async () => {
    const { fonts } = globalThis.document;
    await fonts.ready;
    return [...fonts]
      .filter((face) => face.family.replace(/["']/g, '') === 'Inter' && face.status === 'loaded')
      .map((face) => face.weight);
  });
  for (const weight of ['500', '700']) {
    if (!loadedWeights.includes(weight)) {
      throw new Error(
        `Inter ${weight} did not load, so the wordmark would render in a fallback face`,
      );
    }
  }
};

const renderPng = async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(TEMPLATE_PATH).href, { waitUntil: 'networkidle' });
    await assertInterLoaded(page);
    return await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });
  } finally {
    await browser.close();
  }
};

const replaceShareImageUrl = (imageUrl) => {
  const indexHtml = readFileSync(INDEX_HTML_PATH, 'utf8');
  const matches = indexHtml.match(SHARE_IMAGE_URL_PATTERN) ?? [];
  if (matches.length === 0) {
    throw new Error(`${INDEX_HTML_PATH} names no ${IMAGE_BASENAME} share image URL to replace`);
  }
  writeFileSync(INDEX_HTML_PATH, indexHtml.replace(SHARE_IMAGE_URL_PATTERN, imageUrl));
};

const png = await renderPng();
if (png.length > MAX_BYTES) {
  throw new Error(`Share image is ${png.length} bytes, over the ${MAX_BYTES} byte budget`);
}

const contentHash = createHash('sha256').update(png).digest('hex').slice(0, 8);
const fileName = `${IMAGE_BASENAME}-${contentHash}.png`;

for (const existing of readdirSync(ASSETS_DIR)) {
  if (existing.startsWith(`${IMAGE_BASENAME}-`) && existing.endsWith('.png')) {
    rmSync(join(ASSETS_DIR, existing));
  }
}
writeFileSync(join(ASSETS_DIR, fileName), png);
replaceShareImageUrl(`https://yalelabs.io/assets/${fileName}`);

console.log(`Wrote public/assets/${fileName} (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
