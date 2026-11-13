import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const SCANNED_ROOTS = ['scrapers', 'scripts', 'services'];

const PAGE_FETCH =
  /\b(?:fetchPublicHttpUrl|fetchPage|fetchPageWithPolicy|probeSourceLink|checkSourceLinkHealth)\(|\baxios(?:\.(?:get|head|request))?\(/;
const DESTRUCTIVE_SINK =
  /assertsNoValueFor|\$unset|['"]unreachable['"]|superseded:\s*true|healthStatus:\s*['"]UNAVAILABLE['"]|positivelyDead|\bunreachable[A-Z]\w*\(/;
const NOT_OBSERVED_CLASSIFIER = /\b(?:isNotObserved|isTransientFetchFailure)\b/;

const REVIEWED_WITH_OWN_CONFIRMATION: Record<string, string> = {
  'scrapers/fieldRetraction.ts':
    'retracts only on a positively dead probe: an UNAVAILABLE verdict (404/410 or a confirmed host-level failure), a redirect loop, or a 2xx on another registrable host (#3135)',
  'scrapers/sources/departmentRosterScraper.ts':
    'a failed profile read is recorded as unread and a failed roster read withholds the department',
  'scrapers/sources/labMicrositeDescriptionLLMExtractor.ts':
    'attests an empty slot only after a complete crawl with readable page text',
  'scrapers/sources/labMicrositeUndergradLLMExtractor.ts':
    'withdraws a quote only when its cited page was read with readable text',
  'scrapers/sources/labSiteUndergradInvitationScraper.ts':
    'a failed home read emits nothing and a partial read is held',
  'scrapers/sources/officialProfilePiBackfillScraper.ts':
    'the empty lab-website slot needs a successfully read profile page',
  'scrapers/sources/officialUndergradListScraper.ts':
    'only a 404/410 reads as an empty list and an incomplete source carries stored entries',
  'scrapers/sources/yseFacultyDirectoryScraper.ts':
    'retracts a lab website only on a link-health UNAVAILABLE verdict',
  'scrapers/sources/ysmFacultyDirectoryScraper.ts':
    'retracts a lab website only on a link-health UNAVAILABLE verdict',
  'scripts/clearDeadLabResearchHomes.ts': 'clears a lab home only on a 404 or 410 (#6258)',
  'scripts/nonFetchingLaneGonePages.ts':
    'supersedes only after a confirming probe agrees the page is gone',
  'scripts/repairLegacyPersonPageUrls.ts':
    'replaces an unverified original only after its probe answers 404 or 410 (#6258)',
  'scripts/retireListingItemResearchAreas.ts': 'an unfetchable page retires nothing',
  'scripts/retireOrganizationIdentityWebsiteGrafts.ts':
    'an unresolved URL falls back to its stored spelling and never matches by failure',
  'scripts/retypeFromDeclaredPageType.ts': 'an unreachable page is refused as page-not-read',
  'services/sourceLinkHealth.ts':
    'our own refusals classify UNKNOWN; host-level codes are retried before UNAVAILABLE',
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function fetchesAndWritesAbsence(source: string): boolean {
  return PAGE_FETCH.test(source) && DESTRUCTIVE_SINK.test(source);
}

function filesThatFetchAndWriteAbsence(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of SCANNED_ROOTS) {
    for (const file of sourceFiles(path.join(SERVER_SRC, root))) {
      const source = fs.readFileSync(file, 'utf8');
      if (fetchesAndWritesAbsence(source)) {
        found.set(path.relative(SERVER_SRC, file).split(path.sep).join('/'), source);
      }
    }
  }
  return found;
}

describe('a fetch that observed nothing never becomes evidence (#6258)', () => {
  const atRisk = filesThatFetchAndWriteAbsence();

  it('routes every lane or script that fetches and writes an absence through isNotObserved, or records its own confirmation rule', () => {
    const unclassified = [...atRisk]
      .filter(([, source]) => !NOT_OBSERVED_CLASSIFIER.test(source))
      .map(([file]) => file)
      .filter((file) => !(file in REVIEWED_WITH_OWN_CONFIRMATION));
    expect(unclassified).toEqual([]);
  });

  it('keeps the reviewed list free of files that no longer need it', () => {
    const stale = Object.keys(REVIEWED_WITH_OWN_CONFIRMATION).filter(
      (file) => !atRisk.has(file) || NOT_OBSERVED_CLASSIFIER.test(atRisk.get(file) ?? ''),
    );
    expect(stale).toEqual([]);
  });

  it('recognises a fetch paired with an absence and ignores either alone', () => {
    expect(
      fetchesAndWritesAbsence(
        "const page = await fetchPage(url);\nreturn { assertsNoValueFor: ['x'] };",
      ),
    ).toBe(true);
    expect(fetchesAndWritesAbsence('const page = await fetchPage(url);')).toBe(false);
    expect(fetchesAndWritesAbsence("return { $unset: { websiteUrl: '' } };")).toBe(false);
  });
});
