import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { User } from '../models/user';
import { normalizeName, splitName } from '../scrapers/utils/scraperHelpers';
import { resolveUserForPi as resolveNsfUserForPi } from '../scrapers/sources/nsfAwardScraper';
import { resolveUserForPi as resolveNihUserForPi } from '../scrapers/sources/nihReporterScraper';
import { resolveCanonicalResearchHomeForUser } from '../scrapers/canonicalResearchHomeResolver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SHELL_SLUG = /^(nsf|nih)-pi-/i;
const OBJECT_ID_SLUG = /^(nsf|nih)-pi-[0-9a-f]{24}$/i;
const GRANT_SOURCE_URL =
  /(?:reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov\/awardsearch|api\.nsf\.gov)/i;
const CONCURRENCY = 16;
const OUTPUT_PATH = '/tmp/grant-shell-candidates.json';

const PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'di',
  'da',
  'dos',
  'das',
  'la',
  'le',
  'den',
  'der',
  'ter',
  'ten',
  'bin',
  'al',
  'st',
]);
const FACULTY_TYPES = { $in: ['professor', 'faculty', 'admin'] };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const piNameFromEntity = (name: string): string =>
  normalizeName((name || '').replace(/\s+lab$/i, '').trim());

const hasOfficialWebsite = (entity: {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}): boolean => {
  const urls = [
    typeof entity.websiteUrl === 'string' ? entity.websiteUrl : '',
    typeof entity.website === 'string' ? entity.website : '',
    ...(Array.isArray(entity.sourceUrls)
      ? entity.sourceUrls.map((u) => (typeof u === 'string' ? u : ''))
      : []),
  ].filter(Boolean);
  return urls.some((url) => /^https?:\/\//i.test(url) && !GRANT_SOURCE_URL.test(url));
};

type MissCause =
  | 'common-surname-ambiguity'
  | 'nickname-or-givenname-order'
  | 'particle-compound-surname'
  | 'usertype-filter-exclusion'
  | 'truly-absent'
  | 'unparseable-name';

async function classifyMiss(display: string): Promise<MissCause> {
  const { first, last } = splitName(display);
  if (!last) return 'unparseable-name';
  const tokens = display.split(/\s+/).filter(Boolean);
  const lastTwo = tokens.slice(-2).join(' ');
  const hasParticle = tokens.some((t) => PARTICLES.has(t.replace(/\./g, '').toLowerCase()));
  const hyphenSurname = /-/.test(last);
  const lnameRe = new RegExp(`^${escapeRe(last)}$`, 'i');
  const facultySameLast = await User.countDocuments({ lname: lnameRe, userType: FACULTY_TYPES });
  if (facultySameLast > 1) return 'common-surname-ambiguity';
  if (hasParticle || hyphenSurname) {
    const compoundRe = new RegExp(`^${escapeRe(lastTwo)}$`, 'i');
    const compoundFaculty = await User.countDocuments({
      lname: compoundRe,
      userType: FACULTY_TYPES,
    });
    if (compoundFaculty >= 1) return 'particle-compound-surname';
  }
  if (facultySameLast === 1) return 'nickname-or-givenname-order';
  if (first) {
    const anyTypeExact = await User.countDocuments({
      lname: lnameRe,
      fname: new RegExp(`^${escapeRe(first.split(/\s+/)[0])}`, 'i'),
    });
    if (anyTypeExact >= 1) return 'usertype-filter-exclusion';
  }
  if ((await User.countDocuments({ lname: lnameRe })) >= 1) return 'usertype-filter-exclusion';
  return 'truly-absent';
}

interface ShellDoc {
  _id: unknown;
  slug: string;
  name: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: unknown;
}

interface ShellResult {
  slug: string;
  name: string;
  source: 'nsf' | 'nih';
  slugForm: 'objectId' | 'nameFallback';
  matchedUserId: string | null;
  gate2: 'canonical' | 'safe-shell' | 'ineligible' | 'ambiguous' | 'not-evaluated';
  canonicalTargetSlug?: string;
  graduatedShell: boolean;
  missCause?: MissCause;
}

async function evaluateShell(shell: ShellDoc): Promise<ShellResult> {
  const source = /^nsf/i.test(shell.slug) ? 'nsf' : 'nih';
  const isObjectIdForm = OBJECT_ID_SLUG.test(shell.slug);
  const graduatedShell = hasOfficialWebsite(shell);
  let matchedUserId: string | null = null;
  let missCause: MissCause | undefined;

  if (isObjectIdForm) {
    matchedUserId = shell.slug.replace(SHELL_SLUG, '');
  } else {
    const display = piNameFromEntity(shell.name);
    if (source === 'nsf') {
      const { first, last } = splitName(display);
      const res = await resolveNsfUserForPi({ firstName: first, lastName: last });
      matchedUserId = res.status === 'matched' ? res.userId : null;
    } else {
      const res = await resolveNihUserForPi(display);
      matchedUserId = res.status === 'matched' ? res.user._id : null;
    }
    if (!matchedUserId) missCause = await classifyMiss(display);
  }

  let gate2: ShellResult['gate2'] = 'not-evaluated';
  let canonicalTargetSlug: string | undefined;
  if (matchedUserId) {
    const home = await resolveCanonicalResearchHomeForUser(matchedUserId);
    gate2 = home.status;
    if (home.status === 'canonical') canonicalTargetSlug = home.slug;
  }

  return {
    slug: shell.slug,
    name: shell.name,
    source,
    slugForm: isObjectIdForm ? 'objectId' : 'nameFallback',
    matchedUserId,
    gate2,
    canonicalTargetSlug,
    graduatedShell,
    missCause,
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  await initializeConnections();
  const shells = (await ResearchEntity.find(
    { slug: { $regex: '^(nsf|nih)-pi-', $options: 'i' } },
    { slug: 1, name: 1, websiteUrl: 1, website: 1, sourceUrls: 1 },
  ).lean()) as unknown as ShellDoc[];

  const results = await mapPool(shells, CONCURRENCY, evaluateShell);

  const canonicalCandidates = results.filter((r) => r.gate2 === 'canonical');
  const graduatedShells = results.filter(
    (r) => r.graduatedShell && r.gate2 !== 'canonical',
  );
  const missCauses: Record<string, number> = {};
  for (const r of results) {
    if (r.missCause) missCauses[r.missCause] = (missCauses[r.missCause] || 0) + 1;
  }

  const summary = {
    totalShells: results.length,
    wouldMatchUserNow: results.filter((r) => r.slugForm === 'nameFallback' && r.matchedUserId)
      .length,
    stillMiss: results.filter((r) => r.slugForm === 'nameFallback' && !r.matchedUserId).length,
    alreadyObjectIdLinked: results.filter((r) => r.slugForm === 'objectId').length,
    canonicalMergeCandidates: canonicalCandidates.length,
    graduatedShellsWithOfficialWebsite: graduatedShells.length,
    missCauses,
  };

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        summary,
        canonicalCandidates: canonicalCandidates.map((r) => ({
          shellSlug: r.slug,
          shellName: r.name,
          matchedUserId: r.matchedUserId,
          targetSlug: r.canonicalTargetSlug,
        })),
        graduatedShells: graduatedShells.map((r) => ({
          slug: r.slug,
          name: r.name,
          matchedUserId: r.matchedUserId,
          gate2: r.gate2,
          websiteUrl: shells.find((s) => s.slug === r.slug)?.websiteUrl,
        })),
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFull candidate detail written to ${OUTPUT_PATH}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
