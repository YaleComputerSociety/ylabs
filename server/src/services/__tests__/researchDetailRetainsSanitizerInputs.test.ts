import { describe, expect, it } from 'vitest';

import {
  RESEARCH_DETAIL_WITHHELD_FIELDS,
  publicResearchDetailGroup,
} from '../researchGroupService';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS } from '../researchEntityPublicDescription';

const SOURCE_URL = 'https://medicine.example.edu/profile/fixture-capillary/';

/**
 * Chips the corpus records a source for, whose vocabulary shares nothing with the
 * entity's own text. The coherence pass exists for chips with no provenance at
 * all, so these must survive: the provenance is the evidence that exempts them.
 */
const wholeDocument = () => ({
  _id: 'entity-sourced-incoherent-chips',
  slug: 'fixture-capillary-barrier-lab',
  name: 'Capillary Barrier Lab',
  kind: 'lab',
  entityType: 'LAB',
  departments: ['Pediatrics'],
  researchAreas: ['Sociolinguistic Fieldwork', 'Archival Ethnography'],
  shortDescription:
    'Studies capillary barrier failure and endothelial permeability in critically ill newborns.',
  fullDescription:
    'The lab investigates capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.',
  sourceUrls: [SOURCE_URL],
  websiteUrl: SOURCE_URL,
  fieldProvenance: {
    researchAreas: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
    shortDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
    fullDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
  },
  contactEmail: 'fixture-contact@example.edu',
  contactName: 'Fixture Coordinator',
  contactRole: 'Lab manager',
  contactPhone: '+1 203 000 0000',
  email: 'fixture-lead@example.edu',
  phone: '+1 203 000 0001',
  rosterEnrichment: { lastVerifiedAt: new Date('2026-01-01T00:00:00.000Z') },
  sourceLinkHealth: [{ url: SOURCE_URL, healthStatus: 'LIVE', httpStatusCode: 200 }],
});

const withoutDerivedContributions = (dto: Record<string, unknown>) => {
  const { sourceFieldContributions: _contributions, ...rest } = dto;
  return rest;
};

describe('the research detail narrowing step keeps every serve-time sanitizer input', () => {
  it('withholds no field the public description gate reads', () => {
    const gateInputs = new Set(RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS);
    expect(RESEARCH_DETAIL_WITHHELD_FIELDS.filter((field) => gateInputs.has(field))).toEqual([]);
  });

  it('retains every gate input on the object the DTO sanitizes', () => {
    const document = wholeDocument();
    const narrowed = publicResearchDetailGroup(document) as Record<string, any>;

    for (const field of RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS) {
      if ((document as Record<string, any>)[field] === undefined) continue;
      expect(narrowed[field], `narrowing dropped the gate input ${field}`).toEqual(
        (document as Record<string, any>)[field],
      );
    }
  });

  it('serves identical copy from the narrowed object and the whole document', () => {
    const document = wholeDocument();
    const narrowed = publicResearchDetailGroup(document);

    expect(withoutDerivedContributions(toPublicResearchEntityDto(narrowed))).toEqual(
      withoutDerivedContributions(toPublicResearchEntityDto(document)),
    );
  });

  it('keeps sourced chips the coherence pass would drop without their provenance', () => {
    const document = wholeDocument();
    const narrowed = publicResearchDetailGroup(document);
    const { fieldProvenance: _provenance, ...starved } = narrowed as Record<string, any>;

    expect(toPublicResearchEntityDto(narrowed).researchAreas).toEqual([
      'Sociolinguistic Fieldwork',
      'Archival Ethnography',
    ]);
    expect(toPublicResearchEntityDto(starved).researchAreas).toEqual([]);
  });

  it('never serves provenance or contact fields in the public payload', () => {
    const dto = toPublicResearchEntityDto(publicResearchDetailGroup(wholeDocument()));

    for (const field of ['fieldProvenance', ...RESEARCH_DETAIL_WITHHELD_FIELDS]) {
      expect(Object.keys(dto)).not.toContain(field);
    }
    expect(dto.sourceFieldContributions).toEqual([
      { sourceUrl: SOURCE_URL, contributions: ['Research areas', 'Research summary'] },
    ]);
  });
});
