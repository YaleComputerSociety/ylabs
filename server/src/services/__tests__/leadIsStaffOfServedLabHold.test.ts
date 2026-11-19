import { describe, expect, it } from 'vitest';
import {
  selectLeadIsStaffOfServedLabEntityIds,
  type LeadIsStaffOfServedLabInput,
} from '../studentVisibilityGateService';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const STAFF_ROW_ID = 'a00000000000000000000001';
const SERVED_LAB_ID = 'a00000000000000000000002';
const SERVED_CENTER_ID = 'a00000000000000000000003';
const SERVED_INSTITUTE_ID = 'a00000000000000000000004';
const STAFF_PERSON_ID = 'b00000000000000000000001';
const FACULTY_PERSON_ID = 'b00000000000000000000002';
const SECOND_STAFF_PERSON_ID = 'b00000000000000000000003';

const LAB_SITE = 'https://medicine.example.edu/lab/synthetic-coastal-lab/';
const STAFF_OWN_SITE = 'https://medicine.example.edu/lab/synthetic-staff-core/';
const STAFF_TITLE = 'Laboratory Manager';
const FACULTY_TITLE = 'Associate Professor of Pediatrics';

type Row = { _id: string; entityType: string; websiteUrl?: string; fieldValueRefusals?: unknown };

const wrongOwnerRefusalOf = (url: string) => ({
  websiteUrl: [
    {
      valueKey: fieldValueRefusalKey('websiteUrl', url),
      rule: 'wrong_owner',
      refusedBy: 'fixture-operator',
      refusedAt: new Date('2026-11-01T00:00:00.000Z'),
      note: 'synthetic',
    },
  ],
});

const lead = (userId: string, title: string) => ({ userId, role: 'pi', title });

const buildInput = ({
  staffRow = {},
  staffLeadTitle = STAFF_TITLE,
  labRow = {},
  labLeads = [lead(FACULTY_PERSON_ID, FACULTY_TITLE)],
  staffEdges = [],
  served = [SERVED_LAB_ID, SERVED_CENTER_ID, SERVED_INSTITUTE_ID],
}: {
  staffRow?: Partial<Row>;
  staffLeadTitle?: string;
  labRow?: Partial<Row>;
  labLeads?: Array<Record<string, string>>;
  staffEdges?: Array<{ entityId: string; role: string }>;
  served?: string[];
} = {}): LeadIsStaffOfServedLabInput => {
  const entities: Row[] = [
    {
      _id: STAFF_ROW_ID,
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: STAFF_OWN_SITE,
      ...staffRow,
    },
    { _id: SERVED_LAB_ID, entityType: 'LAB', websiteUrl: LAB_SITE, ...labRow },
    { _id: SERVED_CENTER_ID, entityType: 'CENTER', websiteUrl: 'https://center.example.edu/' },
    {
      _id: SERVED_INSTITUTE_ID,
      entityType: 'INSTITUTE',
      websiteUrl: 'https://institute.example.edu/',
    },
  ];
  const leadsByEntityId = new Map<string, any[]>([
    [STAFF_ROW_ID, [lead(STAFF_PERSON_ID, staffLeadTitle)]],
    [SERVED_LAB_ID, labLeads],
  ]);
  const rosterByEntityId = new Map<string, any[]>([
    [STAFF_ROW_ID, [{ personId: STAFF_PERSON_ID, role: 'pi', state: 'CURRENT' }]],
    [
      SERVED_LAB_ID,
      labLeads.map((labLead) => ({ personId: labLead.userId, role: 'pi', state: 'CURRENT' })),
    ],
  ]);
  for (const edge of staffEdges) {
    rosterByEntityId.set(edge.entityId, [
      ...(rosterByEntityId.get(edge.entityId) || []),
      { personId: STAFF_PERSON_ID, role: edge.role, state: 'CURRENT' },
    ]);
  }
  return {
    entities,
    leadsByEntityId,
    rosterByEntityId,
    servedEntityIds: new Set(served),
    candidateEntityIds: entities.map((entity) => entity._id),
  };
};

const held = (input: LeadIsStaffOfServedLabInput) => [
  ...selectLeadIsStaffOfServedLabEntityIds(input),
];

describe('the lead_is_staff_of_served_lab hold (#5876)', () => {
  it('holds a staff-led row whose own website is a served lab site', () => {
    expect(held(buildInput({ staffRow: { websiteUrl: LAB_SITE } }))).toEqual([STAFF_ROW_ID]);
  });

  it('compares the two sites with the gate url normalization', () => {
    const sameSiteSpelledDifferently =
      'http://MEDICINE.example.edu/lab/synthetic-coastal-lab/index.html';
    expect(held(buildInput({ staffRow: { websiteUrl: sameSiteSpelledDifferently } }))).toEqual([
      STAFF_ROW_ID,
    ]);
  });

  it('holds a staff-led row whose wrong_owner refusal names a served lab site', () => {
    expect(
      held(buildInput({ staffRow: { fieldValueRefusals: wrongOwnerRefusalOf(LAB_SITE) } })),
    ).toEqual([STAFF_ROW_ID]);
  });

  it('ignores a withdrawn wrong_owner refusal', () => {
    const refusals = wrongOwnerRefusalOf(LAB_SITE);
    (refusals.websiteUrl[0] as Record<string, unknown>).withdrawnAt = new Date();
    expect(held(buildInput({ staffRow: { fieldValueRefusals: refusals } }))).toEqual([]);
  });

  it('holds a staff-led row whose lead holds a staff edge on a served row', () => {
    expect(
      held(buildInput({ staffEdges: [{ entityId: SERVED_CENTER_ID, role: 'staff' }] })),
    ).toEqual([STAFF_ROW_ID]);
  });

  it('holds a staff-led row whose lead holds any edge on a served lab', () => {
    expect(
      held(buildInput({ staffEdges: [{ entityId: SERVED_LAB_ID, role: 'affiliated' }] })),
    ).toEqual([STAFF_ROW_ID]);
  });

  it('never holds on an empty lead title', () => {
    expect(
      held(
        buildInput({
          staffLeadTitle: '',
          staffRow: { websiteUrl: LAB_SITE, fieldValueRefusals: wrongOwnerRefusalOf(LAB_SITE) },
          staffEdges: [{ entityId: SERVED_LAB_ID, role: 'staff' }],
        }),
      ),
    ).toEqual([]);
  });

  it('never holds on a research-owning lead title', () => {
    expect(
      held(
        buildInput({
          staffLeadTitle: FACULTY_TITLE,
          staffRow: { websiteUrl: LAB_SITE, fieldValueRefusals: wrongOwnerRefusalOf(LAB_SITE) },
          staffEdges: [{ entityId: SERVED_LAB_ID, role: 'staff' }],
        }),
      ),
    ).toEqual([]);
  });

  it('never holds on a center or institute affiliation edge alone', () => {
    expect(
      held(
        buildInput({
          staffEdges: [
            { entityId: SERVED_CENTER_ID, role: 'affiliated' },
            { entityId: SERVED_CENTER_ID, role: 'core-faculty' },
            { entityId: SERVED_INSTITUTE_ID, role: 'affiliated' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('never holds when the linked row is not served', () => {
    expect(held(buildInput({ staffRow: { websiteUrl: LAB_SITE }, served: [] }))).toEqual([]);
  });

  it('holds neither row of a reciprocal pair', () => {
    expect(
      held(
        buildInput({
          staffRow: { websiteUrl: LAB_SITE },
          labLeads: [lead(SECOND_STAFF_PERSON_ID, STAFF_TITLE)],
          served: [STAFF_ROW_ID, SERVED_LAB_ID],
        }),
      ),
    ).toEqual([]);
  });

  it('gives the same verdict when derived a second time from the same pass', () => {
    const input = buildInput({ staffRow: { fieldValueRefusals: wrongOwnerRefusalOf(LAB_SITE) } });
    expect(held(input)).toEqual(held(input));
    expect(held(input)).toEqual([STAFF_ROW_ID]);
  });
});
