import { describe, expect, it } from 'vitest';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';
import { sanitizeServedResearchEntityCopyFields } from '../researchEntityDescriptionText';
import { normalizeResearchAreaList } from '../researchAreaHygiene';
import { withholdUnservableResearchAreas } from '../servedResearchAreaGuards';

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

describe('withholdUnservableResearchAreas', () => {
  it('withholds a MeSH geographic descriptor read from a MeSH-indexed profile', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Ion Channels', 'China', 'Membrane Transport Proteins', 'Connecticut'],
        meshProfileProvenance,
        coherenceContext,
      ),
    ).toEqual(['Ion Channels', 'Membrane Transport Proteins']);
  });

  it('keeps a place name whose provenance is not a MeSH-indexed profile, since an area-studies page names its field', () => {
    const areas = ['China', 'Ion Channels'];
    expect(
      withholdUnservableResearchAreas(
        areas,
        { researchAreas: { sourceUrl: 'https://area-studies.example.edu/people/' } },
        coherenceContext,
      ),
    ).toBe(areas);
  });

  it('drops an unsourced chip that shares no vocabulary with the row', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Membrane Transport', 'Medieval Troubadour Poetry'],
        undefined,
        coherenceContext,
      ),
    ).toEqual(['Membrane Transport']);
  });

  it('runs the MeSH withhold before the coherence guard, so both apply to one row', () => {
    expect(
      withholdUnservableResearchAreas(
        ['Membrane Transport', 'China'],
        meshProfileProvenance,
        coherenceContext,
      ),
    ).toEqual(['Membrane Transport']);
  });

  it('returns the input reference when nothing is withheld, which the serve path reads as unchanged', () => {
    const areas = ['Ion Channels', 'Membrane Transport'];
    expect(withholdUnservableResearchAreas(areas, meshProfileProvenance, coherenceContext)).toBe(
      areas,
    );
  });
});

describe('the served topic guard chain has one owner', () => {
  const rows = [
    {
      _id: 'entity-mesh-profile-row',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      ...coherenceContext,
      researchAreas: ['Ion Channels', 'China', 'Membrane Transport Proteins'],
      fieldProvenance: meshProfileProvenance,
    },
    {
      _id: 'entity-unsourced-row',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      ...coherenceContext,
      researchAreas: ['Membrane Transport', 'Medieval Troubadour Poetry'],
      fieldProvenance: undefined,
    },
  ];

  it.each(rows)('serves and indexes the same topics the chain keeps for $_id', (row) => {
    const chainKept = normalizeResearchAreaList(
      withholdUnservableResearchAreas(row.researchAreas, row.fieldProvenance, coherenceContext),
    );
    expect(chainKept.length).toBeLessThan(row.researchAreas.length);
    expect(sanitizeServedResearchEntityCopyFields({ ...row }).researchAreas).toEqual(chainKept);
    expect(buildResearchEntitySearchIndexDocument({ ...row })?.researchAreas).toEqual(chainKept);
  });
});
