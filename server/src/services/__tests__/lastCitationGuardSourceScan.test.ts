import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every writer that unsets a `fieldProvenance.*` path, or removes or recomputes `sourceUrls`,
 * routes the write through the shared last-citation rule, so no writer can turn a served row
 * whose only citation is dead into a row with no citation at all (#6320). A new site fails
 * here until it is listed.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');

const PROVENANCE_UNSET_SHAPES: Record<string, RegExp> = {
  unsetMapPath: /unset\[\s*(?:`fieldProvenance\.|'fieldProvenance\.|fieldProvenancePath\()/,
  quotedPathRemoval: /['"`]fieldProvenance\.[^'"`]*['"`]\s*\]?\s*:\s*''/,
  unsetTupleEntry: /\[\s*`fieldProvenance\.[^`]*`\s*,\s*''/,
  pathHelper: /\bfieldProvenancePath\(/,
  computedKeyRemoval:
    /\[\s*(?:(['"])fieldProvenance\.\1\s*\+[^\]]*|`fieldProvenance\.[^`]*`)\s*\]\s*:\s*(?:''|""|1\b|true\b)/,
  computedKeyInUnset:
    /\$unset\s*:\s*\{[^}]*?\[\s*(?:['"]fieldProvenance\.['"]\s*\+|`fieldProvenance\.)/,
  wholeObjectInUnset: /\$unset\s*:\s*\{[^}]*?(?:^|[{,\s])(['"]?)fieldProvenance\1\s*:/m,
  wholeObjectEmptied: /(?:^|[{,])\s*(['"]?)fieldProvenance\1\s*:\s*(?:''|"")/m,
  wholeObjectUnsetMap: /\bunset(?:\.fieldProvenance\b|\[\s*(['"`])fieldProvenance\1\s*\])\s*=/,
};

const SOURCE_URLS_REMOVAL_SHAPES: Record<string, RegExp> = {
  unsetBlock: /\$unset\s*:\s*\{[^}]*?(?:^|[{,\s])(['"]?)sourceUrls\1\s*:/m,
  unsetMap: /\bunset(?:\.sourceUrls\b|\[\s*(['"`])sourceUrls\1\s*\])\s*=/,
  pullBlock: /\$pull\s*:\s*\{[^}]*?(?:^|[{,\s])(['"]?)sourceUrls\1\s*:/m,
  pullMap: /\bpull(?:\.sourceUrls\b|\[\s*(['"`])sourceUrls\1\s*\])\s*=/,
  emptyListKey: /(?:^|[{,])\s*(['"]?)sourceUrls\1\s*:\s*\[\s*\]/m,
  emptyListAssignment: /(?:\.sourceUrls\b|\[\s*(['"`])sourceUrls\1\s*\])\s*=\s*\[\s*\]/,
};

/** A computed list can be empty at runtime, so its writers are held to the same rule. */
const SOURCE_URLS_COMPUTED_SET_SHAPES: Record<string, RegExp> = {
  setBlock: /\$set\s*:\s*\{[^}]*?(?:^|[{,\s])(['"]?)sourceUrls\1\s*[:,}]/m,
  setMapAssignment:
    /\b(?:set|patch|change|update)(?:\.sourceUrls\b|\[\s*(['"`])sourceUrls\1\s*\])\s*=(?!=)/,
  setMapLiteral:
    /\b(?:set|patch|change|update)\b[^=\n;]*=\s*\{[^}]*?(?:^|[{,\s])(['"]?)sourceUrls\1\s*:/m,
};

const SOURCE_URLS_WRITE_SHAPES = {
  ...SOURCE_URLS_REMOVAL_SHAPES,
  ...SOURCE_URLS_COMPUTED_SET_SHAPES,
};

const shapesMatching = (shapes: Record<string, RegExp>, source: string): string[] =>
  Object.entries(shapes)
    .filter(([, shape]) => shape.test(source))
    .map(([name]) => name);

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

const SOURCE_URLS_WRITERS: Record<string, Route> = {
  'scrapers/entityMaterializer.ts': {},
  'scripts/collapseMirroredPersonPageCitations.ts': {},
  'scripts/dropSupersededDeadCitations.ts': {},
  'scripts/purgeSameNameCollisionAreaGrafts.ts': {},
  'scripts/repairSupersededEntitySourceUrls.ts': {},
  'scripts/repairVanityHostCitationsCore.ts': {
    guardedIn: 'scripts/repairVanityHostCitations.ts',
  },
  'scripts/retargetForeignLabWebsites.ts': {},
  'scripts/retireAffiliatedOrgNameGrafts.ts': {},
  'scripts/retireGraftedDirectoryUrls.ts': {},
  'scripts/stripDirectoryLoaderSourceUrls.ts': {},
  'services/researchGroupService.ts': {
    exempt:
      'the empty list is a $setOnInsert default on a newly minted row, and an insert has no prior citation to remove',
  },
  'services/visibilityRepairQueueService.ts': {},
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const read = (relative: string) => fs.readFileSync(path.join(SERVER_SRC, relative), 'utf8');

const filesMatching = (shapes: Record<string, RegExp>): string[] =>
  sourceFiles(SERVER_SRC)
    .map((file) => path.relative(SERVER_SRC, file).split(path.sep).join('/'))
    .filter((relative) => shapesMatching(shapes, read(relative)).length > 0)
    .sort();

const expectRouted = (file: string, route: Route) => {
  if ('exempt' in route) {
    expect(route.exempt.length).toBeGreaterThan(0);
    return;
  }
  expect(read(route.guardedIn ?? file)).toMatch(SHARED_RULE_CALL);
};

describe('fieldProvenance unset sites go through the last-citation rule (#6320)', () => {
  it('lists exactly the files that unset a provenance path', () => {
    expect(filesMatching(PROVENANCE_UNSET_SHAPES)).toEqual(
      Object.keys(PROVENANCE_UNSET_WRITERS).sort(),
    );
  });

  it.each(Object.entries(PROVENANCE_UNSET_WRITERS))('%s calls the shared rule', expectRouted);
});

describe('sourceUrls removal and recompute sites go through the last-citation rule (#6320)', () => {
  it('lists exactly the files that remove or recompute sourceUrls', () => {
    expect(filesMatching(SOURCE_URLS_WRITE_SHAPES)).toEqual(
      Object.keys(SOURCE_URLS_WRITERS).sort(),
    );
  });

  it.each(Object.entries(SOURCE_URLS_WRITERS))('%s calls the shared rule', expectRouted);
});

describe('the scan shapes detect what they claim (#6320)', () => {
  const provenanceCases: Array<[string, string]> = [
    ['quotedPathRemoval', "$unset: { 'fieldProvenance.websiteUrl': '' }"],
    ['computedKeyRemoval', "const unset = { ['fieldProvenance.' + field]: '' };"],
    ['computedKeyRemoval', 'const unset = { [`fieldProvenance.${field}`]: 1 };'],
    ['computedKeyInUnset', "{ $unset: { ['fieldProvenance.' + field]: removal } }"],
    ['computedKeyInUnset', '{ $unset: { [`fieldProvenance.${field}`]: removal } }'],
    ['wholeObjectInUnset', "{ $unset: { fieldProvenance: '' } }"],
    ['wholeObjectInUnset', "{ $unset: { websiteUrl: '', 'fieldProvenance': 1 } }"],
    ['wholeObjectEmptied', "const unset = { websiteUrl: '', fieldProvenance: '' };"],
    ['wholeObjectUnsetMap', "unset.fieldProvenance = '';"],
    ['wholeObjectUnsetMap', "unset['fieldProvenance'] = '';"],
  ];

  it.each(provenanceCases)('%s detects %s', (shape, source) => {
    expect(shapesMatching(PROVENANCE_UNSET_SHAPES, source)).toContain(shape);
  });

  const sourceUrlsCases: Array<[string, string]> = [
    ['unsetBlock', "{ $unset: { sourceUrls: '' } }"],
    ['unsetBlock', "{ $unset: { websiteUrl: '', 'sourceUrls': 1 } }"],
    ['unsetMap', "unset.sourceUrls = '';"],
    ['pullBlock', '{ $pull: { sourceUrls: retiredUrl } }'],
    ['pullBlock', '{ $pull: { sourceUrls: { $in: retiredUrls } } }'],
    ['pullMap', "pull['sourceUrls'] = retiredUrl;"],
    ['emptyListKey', '{ $set: { sourceUrls: [] } }'],
    ['emptyListAssignment', 'set.sourceUrls = [];'],
    ['emptyListAssignment', "set['sourceUrls'] = [ ];"],
    ['setBlock', '{ $set: { name, sourceUrls: keptUrls } }'],
    ['setMapAssignment', 'set.sourceUrls = keptUrls;'],
    ['setMapAssignment', "patch['sourceUrls'] = keptUrls;"],
    ['setMapLiteral', 'const set: Record<string, unknown> = { sourceUrls: keptUrls };'],
  ];

  it.each(sourceUrlsCases)('%s detects %s', (shape, source) => {
    expect(shapesMatching(SOURCE_URLS_WRITE_SHAPES, source)).toContain(shape);
  });

  it.each([
    'const urls = Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [];',
    'const urls = Array.isArray(sourceUrls) ? sourceUrls : [];',
    'if (set.sourceUrls === next) return;',
    '{ $addToSet: { sourceUrls: { $each: urls } } }',
    '{ $setOnInsert: { slug } }',
    '.select({ sourceUrls: 1 })',
  ])('reads and additive writes are not flagged: %s', (source) => {
    expect(shapesMatching(SOURCE_URLS_WRITE_SHAPES, source)).toEqual([]);
    expect(shapesMatching(PROVENANCE_UNSET_SHAPES, source)).toEqual([]);
  });
});
