// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const BUILD_TIMEOUT_MS = 180000;

const GOOGLE_ANALYTICS_MARKERS = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /doubleclick\.net/i,
  /\bgtag\(/,
  /\bG-[A-Z0-9]{10}\b/,
];

const SCANNED_EXTENSIONS = /\.(?:html|js|mjs|css|json|txt|svg|webmanifest)$/;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });

let outDir: string;
let builtFiles: string[];

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'ylabs-client-build-'));
  await build({
    root: CLIENT_ROOT,
    configFile: join(CLIENT_ROOT, 'vite.config.js'),
    mode: 'production',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false },
  });
  builtFiles = filesUnder(outDir).map((file) => relative(outDir, file));
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const googleAnalyticsHits = (): string[] =>
  builtFiles
    .filter((file) => SCANNED_EXTENSIONS.test(file))
    .flatMap((file) =>
      readFileSync(join(outDir, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          GOOGLE_ANALYTICS_MARKERS.filter((marker) => marker.test(line)).map(
            (marker) => `${file}:${index + 1} ${marker}`,
          ),
        ),
    );

describe('the production client build ships no Google Analytics', () => {
  it('emits the entry document and a script bundle to scan', () => {
    expect(builtFiles).toContain('index.html');
    expect(builtFiles.some((file) => /\.js$/.test(file))).toBe(true);
  });

  it('has no Google tag loader, measurement id, gtag call or measurement host in any built file', () => {
    expect(googleAnalyticsHits()).toEqual([]);
  });

  it('does not ship the GA bootstrap script', () => {
    expect(builtFiles).not.toContain('analytics.js');
  });
});
