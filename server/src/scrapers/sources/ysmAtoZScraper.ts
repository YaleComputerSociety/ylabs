/**
 * YsmAtoZScraper
 *
 * Scrapes Yale School of Medicine's centralized A-to-Z lab websites index:
 * https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/
 *
 * The page is a single HTML table with ~266 rows, each `<tr>` containing a lab name
 * (link) and the lab website URL. No PI names are shown directly; we infer the PI
 * surname from the lab name ("Arnsten Lab" -> "Arnsten") and try to match it against
 * existing Yale faculty Users.
 *
 * Each row produces ResearchGroup observations keyed by slug (derived from the URL or
 * from the lab name). The slug is the unique identifier `EntityMaterializer` uses to
 * upsert the ResearchGroup.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { User } from '../../models/user';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const PAGE_URL = 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/';

interface RawLab {
  name: string;
  url: string;
  slug: string;
}

function slugifyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/lab\/([^/]+)/i);
    if (m && m[1]) return `ysm-${m[1].toLowerCase()}`;
  } catch {
    /* ignore malformed URLs */
  }
  return null;
}

function slugifyFromName(name: string): string {
  return (
    'ysm-' +
    name
      .toLowerCase()
      .replace(/['']s\b/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  );
}

function inferPiSurname(name: string): string | null {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/['']s\b/g, '');
  const tokens = stripped.split(/\s+/);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx > 0) {
    const candidate = tokens[labIdx - 1];
    if (/^[A-Z][a-zA-Z\-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  if (tokens.length > 0 && /^[A-Z][a-zA-Z\-]+$/.test(tokens[0])) {
    return tokens[0];
  }
  return null;
}

async function fetchPage(useCache: boolean): Promise<string> {
  if (useCache) {
    const cached = await getCached<string>('ysm-atoz-index', 'page');
    if (cached) return cached;
  }
  const res = await axios.get(PAGE_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
  });
  const html = res.data as string;
  if (useCache) await setCached('ysm-atoz-index', 'page', html);
  return html;
}

function parseLabs(html: string): RawLab[] {
  const $ = cheerio.load(html);
  const labs: RawLab[] = [];

  $('table tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 1) return;

    const linkEl = cells.eq(0).find('a').first();
    let name = linkEl.text().trim();
    let url = linkEl.attr('href') || '';

    if (!name) {
      name = cells.eq(0).text().trim();
    }
    if (!url && cells.length > 1) {
      const altLink = cells.eq(1).find('a').first();
      url = altLink.attr('href') || cells.eq(1).text().trim();
    }

    if (!name || !url) return;
    if (!/^https?:\/\//i.test(url)) return;

    const slug = slugifyFromUrl(url) || slugifyFromName(name);
    labs.push({ name, url, slug });
  });

  return labs;
}

async function findPiUserId(surname: string | null): Promise<string | null> {
  if (!surname) return null;
  const matches = await User.find(
    {
      lname: new RegExp(`^${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      userType: { $in: ['professor', 'faculty'] },
    },
    { _id: 1, fname: 1, lname: 1, primaryDepartment: 1 },
  )
    .limit(5)
    .lean();
  if (matches.length !== 1) return null;
  const m: any = matches[0];
  if (m.primaryDepartment && /medicine|health|nursing|public health/i.test(m.primaryDepartment)) {
    return String(m._id);
  }
  return String(m._id);
}

function labToObservations(lab: RawLab, sourceUrl: string): ObservationInput[] {
  const base = { entityType: 'researchGroup' as const, entityKey: lab.slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: lab.slug },
    { ...base, field: 'name', value: lab.name },
    { ...base, field: 'kind', value: 'lab' },
    { ...base, field: 'school', value: 'Yale School of Medicine' },
    { ...base, field: 'websiteUrl', value: lab.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, lab.url] },
    { ...base, field: 'openness', value: 'open' },
    { ...base, field: 'acceptingUndergrads', value: true },
  ];
}

export class YsmAtoZScraper implements IScraper {
  readonly name = 'ysm-atoz-index';
  readonly displayName = 'YSM A-to-Z Lab Websites';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    ctx.log(`Fetching ${PAGE_URL}`);
    const html = await fetchPage(ctx.options.useCache);
    const labs = parseLabs(html);
    ctx.log(`Parsed ${labs.length} labs from index`);

    const limited =
      ctx.options.limit && ctx.options.limit > 0 ? labs.slice(0, ctx.options.limit) : labs;

    let totalObs = 0;
    let piMatched = 0;

    for (const lab of limited) {
      const observations = labToObservations(lab, PAGE_URL);
      const surname = inferPiSurname(lab.name);
      const piUserId = await findPiUserId(surname);
      if (piUserId) {
        observations.push({
          entityType: 'researchGroup',
          entityKey: lab.slug,
          field: 'inferredPiUserId',
          value: piUserId,
          sourceUrl: PAGE_URL,
          confidenceOverride: 0.5,
        });
        piMatched++;
      }
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    ctx.log(`Emitted ${totalObs} observations across ${limited.length} labs`);
    ctx.log(`Inferred PI for ${piMatched}/${limited.length} labs`);

    return {
      observationCount: totalObs,
      entitiesObserved: limited.length,
      notes: `Discovered ${limited.length} YSM labs (${piMatched} with inferred PI)`,
    };
  }
}
