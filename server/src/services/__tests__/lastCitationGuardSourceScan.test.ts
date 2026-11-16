import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every writer that unsets a `fieldProvenance.*` path routes the write through the shared
 * last-citation rule, so no writer can turn a served row whose only citation is dead into a
 * row with no citation at all (#6320). A new unset site fails here until it is listed.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');

const PROVENANCE_UNSET_SHAPES = [
  /unset\[\s*(?:`fieldProvenance\.|'fieldProvenance\.|fieldProvenancePath\()/,
  /['"`]fieldProvenance\.[^'"`]*['"`]\s*\]?\s*:\s*''/,
  /\[\s*`fieldProvenance\.[^`]*`\s*,\s*''/,
  /\bfieldProvenancePath\(/,
];

const SHARED_RULE_CALL =
  /\b(?:withholdLastCitationRemovals|withholdLastCitationRemovalsFromUpdate|updateOneKeepingLastCitation|wouldRemoveLastCitation)\(/;

type Route = { guardedIn?: string } | { exempt: string };

const PROVENANCE_UNSET_WRITERS: Record<string, Route> = {
  'scrapers/entityMaterializer.ts': {},
  'scrapers/fieldRetraction.ts': {},
  'scripts/clearDeadLabResearchHomes.ts': {},
  'scripts/clearDeadResearchWebsitesCore.ts': {},
  'scripts/clearStaleRefusalProvenance.ts': {},
  'scripts/dropSupersededDeadCitations.ts': {},
  'scripts/fraProfileSynthesisLane.ts': {},
  'scripts/labBrandedNameTypeBackfill.ts': {},
  'scripts/refuseResearchEntityFieldValue.ts': {},
  'scripts/refusedFieldProvenance.ts': {},
  'scripts/repairPromotionRegressedWebsiteUrlsCore.ts': {
    guardedIn: 'scripts/repairPromotionRegressedWebsiteUrls.ts',
  },
  'scripts/retargetForeignLabWebsites.ts': {},
  'scripts/retireAffiliatedOrgNameGrafts.ts': {},
  'scripts/retireBorrowedLabWebsites.ts': {},
  'scripts/retireGraftedDirectoryUrls.ts': {},
  'scripts/retireListingItemResearchAreas.ts': {},
  'scripts/retireOrganizationIdentityWebsiteGrafts.ts': {},
  'scripts/retireSharedRosterWebsites.ts': {},
  'scripts/retireStaleLaunchSuppressionOverrides.ts': {},
  'services/fellowshipService.ts': {
    exempt:
      'lifts a fellowship visibility override; a fellowship is not a research entity, so the research visibility gate never reads its citations',
  },
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const read = (relative: string) => fs.readFileSync(path.join(SERVER_SRC, relative), 'utf8');

describe('fieldProvenance unset sites go through the last-citation rule (#6320)', () => {
  const found = sourceFiles(SERVER_SRC)
    .map((file) => path.relative(SERVER_SRC, file).split(path.sep).join('/'))
    .filter((relative) => PROVENANCE_UNSET_SHAPES.some((shape) => shape.test(read(relative))))
    .sort();

  it('lists exactly the files that unset a provenance path', () => {
    expect(found).toEqual(Object.keys(PROVENANCE_UNSET_WRITERS).sort());
  });

  it.each(Object.entries(PROVENANCE_UNSET_WRITERS))('%s calls the shared rule', (file, route) => {
    if ('exempt' in route) {
      expect(route.exempt.length).toBeGreaterThan(0);
      return;
    }
    expect(read(route.guardedIn ?? file)).toMatch(SHARED_RULE_CALL);
  });
});
