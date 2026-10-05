import { describe, expect, it } from 'vitest';
import {
  addResearchEntitySearchAliases,
  decideServedResearchEntityTopics,
  researchEntityListServedSource,
  toPublicResearchEntityDto,
} from '../../services/researchEntityDto';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';
import { sanitizeServedResearchEntityCopyFields } from '../researchEntityDescriptionText';
import {
  decideServedResearchAreas,
  type ServedResearchAreaDecisionInput,
  type ServedResearchAreaGuard,
  unattributedResearchAreaDrops,
} from '../servedResearchAreaGuards';

const coherenceContext = {
  name: 'Example Membrane Transport Laboratory',
  departments: ['Cellular and Molecular Physiology'],
  shortDescription: 'Studies membrane transport proteins and ion channel physiology.',
  fullDescription:
    'The laboratory studies membrane transport proteins, ion channel gating, epithelial physiology, and structural biology of transporters using electrophysiology and cryo-electron microscopy.',
};

const meshProfileProvenance = {
  researchAreas: { sourceUrl: 'https://medicine.yale.edu/profile/example-person/' },
};

const departmentPageProvenance = {
  researchAreas: { sourceUrl: 'https://physiology.example.edu/research/' },
};

const proseProgramTitle =
  'Synthetic Interdisciplinary Training Program in Membrane Transport Biology (SITPMTB)';

const decide = (
  areas: string[],
  fieldProvenance: unknown,
  surface: ServedResearchAreaDecisionInput['surface'],
) => decideServedResearchAreas(areas, { surface, fieldProvenance, coherenceContext });

const guardsOf = (decision: { withheld: Array<{ guard: ServedResearchAreaGuard }> }) =>
  decision.withheld.map((withheld) => withheld.guard);

describe('decideServedResearchAreas', () => {
  it('withholds a MeSH geographic descriptor read from a MeSH-indexed profile', () => {
    const decision = decide(
      ['Ion Channels', 'China', 'Membrane Transport Proteins', 'Connecticut'],
      meshProfileProvenance,
      'searchIndex',
    );
    expect(decision.served).toEqual(['Ion Channels', 'Membrane Transport Proteins']);
    expect(decision.withheld).toEqual([
      { area: 'China', guard: 'withoutMeshSourcedNonSubjectResearchAreas' },
      { area: 'Connecticut', guard: 'withoutMeshSourcedNonSubjectResearchAreas' },
    ]);
  });

  it('keeps a place name whose provenance is not a MeSH-indexed profile, since an area-studies page names its field', () => {
    const decision = decide(
      ['China', 'Ion Channels'],
      { researchAreas: { sourceUrl: 'https://area-studies.example.edu/people/' } },
      'servedCopy',
    );
    expect(decision).toEqual({ served: ['China', 'Ion Channels'], withheld: [] });
  });

  it('drops an unsourced chip that shares no vocabulary with the row', () => {
    const decision = decide(
      ['Membrane Transport', 'Medieval Troubadour Poetry'],
      undefined,
      'servedCopy',
    );
    expect(decision.served).toEqual(['Membrane Transport']);
    expect(guardsOf(decision)).toEqual(['dropDomainIncoherentUnsourcedResearchAreas']);
  });

  it('runs the MeSH withhold before the coherence guard, so both apply to one row', () => {
    const decision = decide(['Membrane Transport', 'China'], meshProfileProvenance, 'servedCopy');
    expect(decision.served).toEqual(['Membrane Transport']);
    expect(guardsOf(decision)).toEqual(['withoutMeshSourcedNonSubjectResearchAreas']);
  });

  it('withholds a prose-length chip from the served copy and names the prose filter', () => {
    const decision = decide(
      ['Ion Channels', proseProgramTitle],
      departmentPageProvenance,
      'servedCopy',
    );
    expect(decision.served).toEqual(['Ion Channels']);
    expect(decision.withheld).toEqual([
      { area: proseProgramTitle, guard: 'filterProseResearchAreaChips' },
    ]);
  });

  it('keeps that chip on the search index surface, which matches on topics but never renders them', () => {
    const decision = decide(
      ['Ion Channels', proseProgramTitle],
      departmentPageProvenance,
      'searchIndex',
    );
    expect(decision).toEqual({ served: ['Ion Channels', proseProgramTitle], withheld: [] });
  });

  it('charges a case-folded duplicate to the chip hygiene rather than losing it', () => {
    const decision = decide(
      ['Ion Channels', 'ion channels'],
      departmentPageProvenance,
      'servedCopy',
    );
    expect(decision.served).toEqual(['Ion Channels']);
    expect(decision.withheld).toEqual([
      { area: 'ion channels', guard: 'servedResearchAreaChipHygiene' },
    ]);
  });
});

const syntheticRow = (id: string, researchAreas: string[], fieldProvenance: unknown) => ({
  _id: id,
  slug: id,
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  archived: false,
  ...coherenceContext,
  researchAreas,
  fieldProvenance,
});

const parityRows: Array<{
  row: ReturnType<typeof syntheticRow>;
  servedGuards: ServedResearchAreaGuard[];
}> = [
  {
    row: syntheticRow(
      'entity-mesh-profile-row',
      ['Ion Channels', 'China', 'Membrane Transport Proteins'],
      meshProfileProvenance,
    ),
    servedGuards: ['withoutMeshSourcedNonSubjectResearchAreas'],
  },
  {
    row: syntheticRow(
      'entity-unsourced-row',
      ['Membrane Transport', 'Medieval Troubadour Poetry'],
      undefined,
    ),
    servedGuards: ['dropDomainIncoherentUnsourcedResearchAreas'],
  },
  {
    row: syntheticRow(
      'entity-prose-chip-row',
      ['Ion Channels', proseProgramTitle],
      departmentPageProvenance,
    ),
    servedGuards: ['filterProseResearchAreaChips'],
  },
  {
    row: syntheticRow(
      'entity-overlong-row',
      Array.from({ length: 104 }, (_, index) => `Membrane Transport Topic ${index + 1}`),
      departmentPageProvenance,
    ),
    servedGuards: ['servedCopyArrayBound'],
  },
];

const indexSurfaceDecision = (row: ReturnType<typeof syntheticRow>) => {
  const indexed = buildResearchEntitySearchIndexDocument({ ...row });
  const decision = decideServedResearchAreas(row.researchAreas, {
    surface: 'searchIndex',
    fieldProvenance: row.fieldProvenance,
    coherenceContext: {
      name: indexed?.name,
      displayName: indexed?.displayName,
      departments: indexed?.departments,
      shortDescription: indexed?.shortDescription,
      fullDescription: indexed?.fullDescription,
    },
  });
  return { indexedAreas: indexed?.researchAreas ?? [], decision };
};

describe('the served topic decision has one owner', () => {
  it.each(parityRows)(
    'the detail DTO serves exactly the decision for $row._id, naming the guard that withheld each drop',
    ({ row, servedGuards }) => {
      const decision = decideServedResearchEntityTopics({ ...row });
      expect(decision.served.length).toBeLessThan(row.researchAreas.length);
      expect(new Set(guardsOf(decision))).toEqual(new Set(servedGuards));
      expect(unattributedResearchAreaDrops(row.researchAreas, decision)).toEqual([]);
      expect(toPublicResearchEntityDto({ ...row }).researchAreas).toEqual(decision.served);
    },
  );

  it.each(parityRows)('the browse card serves exactly the decision for $row._id', ({ row }) => {
    const browsed = addResearchEntitySearchAliases({ hits: [{ ...row }] });
    const decision = decideServedResearchEntityTopics(
      researchEntityListServedSource({ ...row }, undefined, false),
    );
    expect(browsed.researchEntities[0].researchAreas).toEqual(decision.served);
  });

  it.each(parityRows)(
    'the served copy sanitizer keeps exactly the decision for $row._id before the DTO projection',
    ({ row }) => {
      const bounded = { ...row, researchAreas: row.researchAreas.slice(0, 100) };
      const decision = decideServedResearchAreas(bounded.researchAreas, {
        surface: 'servedCopy',
        fieldProvenance: row.fieldProvenance,
        coherenceContext,
      });
      expect(sanitizeServedResearchEntityCopyFields(bounded).researchAreas).toEqual(
        decision.served,
      );
    },
  );

  it.each(parityRows)(
    'the search index document indexes exactly the search index decision for $row._id',
    ({ row }) => {
      const { indexedAreas, decision } = indexSurfaceDecision(row);
      expect(indexedAreas).toEqual(decision.served);
    },
  );

  it('keeps the index and the DTO apart only where the surface argument says so', () => {
    const proseRow = parityRows.find(({ row }) => row._id === 'entity-prose-chip-row')!.row;
    const { indexedAreas } = indexSurfaceDecision(proseRow);
    expect(indexedAreas).toContain(proseProgramTitle);
    expect(toPublicResearchEntityDto({ ...proseRow }).researchAreas).not.toContain(
      proseProgramTitle,
    );

    const meshRow = parityRows.find(({ row }) => row._id === 'entity-mesh-profile-row')!.row;
    expect(indexSurfaceDecision(meshRow).indexedAreas).toEqual(
      toPublicResearchEntityDto({ ...meshRow }).researchAreas,
    );
  });
});
