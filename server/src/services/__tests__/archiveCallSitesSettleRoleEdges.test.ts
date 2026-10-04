import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// An archive that bypasses `archiveResearchEntities` leaves its role edges current on a
// row the serve path refuses: 176 such edges failed `integrity-gate` on Development (#4752),
// and live signals on archived rows failed it again within hours of a repair (#4816).
// A new caller of either archive builder fails here until it routes through the helper or
// is listed with the reason it does not archive a research entity's edges.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');

const REVIEWED_ARCHIVED_ENTITY_UPDATE_CALLERS: Record<string, { sites: number; reason: string }> = {
  'services/archivedResearchEntityRoleEdges.ts': {
    sites: 1,
    reason: 'the helper itself, which settles role edges and access signals in the same step',
  },
  'scrapers/entityMaterializer.ts': {
    sites: 1,
    reason:
      'builds the planned set a dry run reports for the program-lives-on-programs archive; the write itself goes through archiveResearchEntities',
  },
  'scripts/dedupeResearchEntitiesByPi.ts': {
    sites: 2,
    reason:
      'applyResearchEntityDedupeMergeGroup repoints or retires every duplicate edge itself, and is the semantics archiveResearchEntities copies; the other site archives relinked reference documents, not research entities',
  },
};

const REVIEWED_ATTRIBUTED_ARCHIVE_SET_CALLERS: Record<string, { sites: number; reason: string }> = {
  'models/entityArchival.ts': { sites: 1, reason: 'archivedEntityUpdate builds on it' },
  'scrapers/centerRosterRetirement.ts': { sites: 1, reason: 'archives relationships' },
  'scrapers/entityMaterializer.ts': { sites: 1, reason: 'archives superseded relationships' },
  'scrapers/accessMaterializer.ts': { sites: 1, reason: 'archives access signals' },
  'scripts/archiveLegacyAccessSignals.ts': { sites: 1, reason: 'archives access signals' },
  'scripts/repairOrphanedObservationReferences.ts': {
    sites: 2,
    reason: 'archives owners in ARCHIVABLE_REFERENCE_COLLECTIONS, which holds signals only',
  },
  'services/archivedResearchEntityAccessSignals.ts': {
    sites: 1,
    reason: 'archives access signals, for archiveResearchEntities and the repair alike',
  },
  'scripts/dedupeResearchEntitiesByPi.ts': { sites: 1, reason: 'archives self-relationships' },
  'scripts/repairDuplicateAccessSignals.ts': { sites: 1, reason: 'archives access signals' },
};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

const callSiteCounts = (pattern: RegExp): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SERVER_SRC)) {
    const matches = fs.readFileSync(file, 'utf8').match(pattern);
    if (matches) counts[path.relative(SERVER_SRC, file).split(path.sep).join('/')] = matches.length;
  }
  return counts;
};

const reviewedCounts = (reviewed: Record<string, { sites: number }>) =>
  Object.fromEntries(Object.entries(reviewed).map(([file, { sites }]) => [file, sites]));

describe('every research-entity archive settles its role edges and access signals (#4752, #4816)', () => {
  it('lists every archivedEntityUpdate caller that is not archiveResearchEntities', () => {
    expect(callSiteCounts(/\barchivedEntityUpdate\(/g)).toEqual(
      reviewedCounts(REVIEWED_ARCHIVED_ENTITY_UPDATE_CALLERS),
    );
  });

  it('lists every attributedArchiveSet caller with the collection it archives', () => {
    expect(callSiteCounts(/\battributedArchiveSet\(/g)).toEqual(
      reviewedCounts(REVIEWED_ATTRIBUTED_ARCHIVE_SET_CALLERS),
    );
  });

  it('settles both role edges and access signals inside archiveResearchEntities', () => {
    const helper = fs.readFileSync(
      path.join(SERVER_SRC, 'services/archivedResearchEntityRoleEdges.ts'),
      'utf8',
    );
    const body = helper.slice(helper.indexOf('export async function archiveResearchEntities('));
    expect(body).toMatch(/await settleRoleEdgesOfArchivedResearchEntities\(\{/);
    expect(body).toMatch(/await settleAccessSignalsOfArchivedResearchEntities\(\{/);
  });

  it('routes each lane that archives a research entity through archiveResearchEntities', () => {
    const callers = Object.keys(callSiteCounts(/\barchiveResearchEntities\(\{/g))
      .filter((file) => file !== 'services/archivedResearchEntityRoleEdges.ts')
      .sort();
    expect(callers).toEqual(
      [
        'scrapers/entityMaterializer.ts',
        'scripts/mergeSameLeadDuplicateGroups.ts',
        'scripts/portGrantShellsToFacultyProfiles.ts',
        'scripts/retireDeadCitationResearchEntities.ts',
        'scripts/retireProgramResearchEntities.ts',
        'scripts/retireStaffMintedResearchEntities.ts',
        'scripts/withdrawNonResearchHomeRow.ts',
      ].sort(),
    );
  });
});
