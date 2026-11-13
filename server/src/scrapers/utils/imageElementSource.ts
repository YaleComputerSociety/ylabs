import type * as cheerio from 'cheerio';

interface SrcsetEntry {
  url: string;
  size: number;
}

function srcsetEntries(value: string | undefined | null): SrcsetEntry[] {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([url]) => Boolean(url))
    .map(([url, descriptor]) => ({
      url,
      size: Number.parseFloat(String(descriptor || '').replace(/[wx]$/i, '')) || Infinity,
    }));
}

function smallestImageUrlFromSrcset(value: string | undefined | null): string | undefined {
  const entries = srcsetEntries(value);
  if (entries.length === 0) return undefined;
  return entries.reduce((smallest, entry) => (entry.size < smallest.size ? entry : smallest)).url;
}

const renderedSource = (value: string | undefined): string | undefined =>
  value && !/^data:/i.test(value.trim()) ? value : undefined;

export function imageElementSource(node: cheerio.Cheerio<any>): string {
  const img = node.find('img').first();
  if (!img.length) return '';
  return (
    renderedSource(img.attr('src')) ||
    renderedSource(img.attr('data-src')) ||
    smallestImageUrlFromSrcset(img.attr('srcset')) ||
    smallestImageUrlFromSrcset(img.attr('data-srcset')) ||
    ''
  );
}
