import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SCRAPERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OBSERVATION_READ = /\bObservation\.(find|findOne|exists|aggregate|distinct|countDocuments)\(/;
const DECLARATION = /^(?:export )?(?:async )?(?:function\s+(\w+)|const\s+(\w+)\b)/;
const MERGED_ROW_HELPER =
  /\b(mergedRowEvidenceQueryClauses|observationBelongsToMergedRow|mergedInMemberOf|identityClauses)\(/;

type ReadScope = 'merged-row' | 'row-only' | 'not-a-row-evidence-read';

const CLASSIFIED_READS: Record<string, Record<string, ReadScope>> = {
  'entityMaterializer.ts': {
    listingsSharingProfileUrl: 'not-a-row-evidence-read',
    resolveNetidForRosterEmailAlias: 'not-a-row-evidence-read',
    leadPiInheritanceEvidence: 'row-only',
    fundFacetObservationsCitedBy: 'not-a-row-evidence-read',
    entityIdAnchoredObservationsExcludedByEntityKeyScope: 'row-only',
    entityKeyAnchoredObservationsExcludedByEntityIdScope: 'row-only',
    mergedSurvivorEvidence: 'merged-row',
    liveResearchEntityNamesUserKeyAsLead: 'not-a-row-evidence-read',
    materializeEntity: 'row-only',
    reconcileOfficialRosterSnapshotsFromRun: 'not-a-row-evidence-read',
    liveOtherSourceObservations: 'not-a-row-evidence-read',
    materializeFromRun: 'not-a-row-evidence-read',
  },
  'neverBackedFieldProvenance.ts': {
    sourceEverObservedField: 'merged-row',
    liveObservationsOfField: 'merged-row',
  },
  'researchAreaEvidence.ts': {
    loadLiveResearchAreaObservations: 'merged-row',
  },
  'accessMaterializer.ts': {
    deriveAccessArtifactsForResearchGroup: 'row-only',
    foreignContactFieldSignalIds: 'row-only',
  },
};

interface EvidenceRead {
  file: string;
  declaration: string;
  body: string;
}

function evidenceReadsIn(file: string): EvidenceRead[] {
  const lines = fs.readFileSync(path.join(SCRAPERS_DIR, file), 'utf8').split('\n');
  const declarations: Array<{ name: string; start: number }> = [];
  lines.forEach((line, index) => {
    const match = DECLARATION.exec(line);
    if (match) declarations.push({ name: match[1] ?? match[2], start: index });
  });
  const reads: EvidenceRead[] = [];
  lines.forEach((line, index) => {
    if (!OBSERVATION_READ.test(line)) return;
    const position = declarations.filter((declaration) => declaration.start <= index).length - 1;
    const enclosing = declarations[position];
    const end = declarations[position + 1]?.start ?? lines.length;
    reads.push({
      file,
      declaration: enclosing?.name ?? '<top level>',
      body: lines.slice(enclosing?.start ?? 0, end).join('\n'),
    });
  });
  return reads;
}

describe('every materializer evidence read decides whether it reaches merged-in keys (#4418)', () => {
  const reads = Object.keys(CLASSIFIED_READS).flatMap(evidenceReadsIn);

  it('finds the reads it is meant to guard', () => {
    expect(reads.length).toBeGreaterThanOrEqual(18);
  });

  it('classifies every read, so a new one has to choose', () => {
    const unclassified = reads
      .filter((read) => CLASSIFIED_READS[read.file][read.declaration] === undefined)
      .map((read) => `${read.file}: ${read.declaration}`);

    expect(unclassified).toEqual([]);
  });

  it('routes every merged-row read through the shared identity helper', () => {
    const bypassing = reads
      .filter((read) => CLASSIFIED_READS[read.file][read.declaration] === 'merged-row')
      .filter((read) => !MERGED_ROW_HELPER.test(read.body))
      .map((read) => `${read.file}: ${read.declaration}`);

    expect(bypassing).toEqual([]);
  });
});
