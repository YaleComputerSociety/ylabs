// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(CLIENT_ROOT, '..');
const SOURCE_DIR = join(CLIENT_ROOT, 'src');
const PRODUCT_ANALYTICS_MODULE = 'utils/productAnalytics.ts';

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });

const appSources = filesUnder(SOURCE_DIR)
  .filter((file) => /\.(?:ts|tsx)$/.test(file) && !/__tests__|\.test\./.test(file))
  .map((file) => ({ path: relative(SOURCE_DIR, file), text: readFileSync(file, 'utf8') }));

describe('PostHog usage in the client', () => {
  it('is reached only through the product analytics module', () => {
    const importers = appSources
      .filter(({ text }) => /from ['"]posthog-js|import\(['"]posthog-js/.test(text))
      .map(({ path }) => path);

    expect(importers).toEqual([PRODUCT_ANALYTICS_MODULE]);
  });

  it('imports the SDK lazily, never as a value at module load', () => {
    const module = appSources.find(({ path }) => path === PRODUCT_ANALYTICS_MODULE)!.text;

    expect(module).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]posthog-js/m);
    expect(module).toMatch(/import\(['"]posthog-js\/no-external['"]\)/);
  });

  it('identifies only through the bootstrap of a server-issued opaque ID', () => {
    const bootstraps = appSources.flatMap(({ path, text }) =>
      (text.match(/^.*\bbootstrap\s*:.*$/gm) ?? []).map((line) => `${path}: ${line.trim()}`),
    );
    const module = appSources.find(({ path }) => path === PRODUCT_ANALYTICS_MODULE)!.text;

    expect(bootstraps).toEqual([
      `${PRODUCT_ANALYTICS_MODULE}: ...(identifiedAs ? { bootstrap: { distinctID: identifiedAs, isIdentifiedID: true } } : {}),`,
    ]);
    expect(module).toMatch(/const identifiedAs = opaqueProductAnalyticsId\(distinctId\);/);
  });

  it('never identifies, aliases or attaches person or group properties', () => {
    const calls = appSources.flatMap(({ path, text }) =>
      [
        /\.identify\(/,
        /\.alias\(/,
        /\.setPersonProperties\w*\(/,
        /\.register(?:_once|ForSession)?\(/,
        /\.group\(/,
        /\.people\./,
      ]
        .filter((pattern) => pattern.test(text) && /posthog/i.test(text))
        .map((pattern) => `${path} ${pattern}`),
    );

    expect(calls).toEqual([]);
  });

  it('commits no PostHog project key', () => {
    const scanned = [
      ...filesUnder(SOURCE_DIR),
      ...filesUnder(join(REPO_ROOT, 'docs')),
      join(CLIENT_ROOT, '.env.example'),
      join(REPO_ROOT, 'server', '.env.example'),
    ].filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });
    const keys = scanned.flatMap((file) =>
      (readFileSync(file, 'utf8').match(/phc_[A-Za-z0-9]{20,}/g) ?? [])
        .filter((key) => !key.startsWith('phc_synthetic'))
        .map((key) => `${relative(REPO_ROOT, file)} ${key.slice(0, 8)}`),
    );

    expect(keys).toEqual([]);
  });
});
