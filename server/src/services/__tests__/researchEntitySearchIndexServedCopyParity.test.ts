import { describe, expect, it } from 'vitest';
import {
  buildResearchEntitySearchIndexDocument,
  type ResearchEntitySearchServedLead,
} from '../researchEntitySearchIndexService';
import { servedResearchEntitySearchCopy, toServedResearchEntityDto } from '../researchEntityDto';

const DTO_PARITY_FIELDS = ['fullDescription', 'methods'] as const;

const servedValue = (value: unknown): unknown =>
  (Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0)
    ? value
    : undefined;

const labRow = (overrides: Record<string, unknown>) => ({
  _id: 'entity-parity',
  slug: 'parity-lab',
  name: 'Quillfeather Computational Ecology Lab',
  entityType: 'LAB',
  kind: 'lab',
  studentVisibilityTier: 'student_ready',
  researchAreas: ['Ecology', 'Population Dynamics'],
  ...overrides,
});

const expectIndexedCopyToMatchServed = (
  row: Record<string, unknown>,
  servedLead: ResearchEntitySearchServedLead = {},
) => {
  const indexed = buildResearchEntitySearchIndexDocument(row, undefined, servedLead);
  const served: Record<string, unknown> = toServedResearchEntityDto(row, servedLead);
  for (const field of DTO_PARITY_FIELDS) {
    expect(servedValue(indexed?.[field]), field).toEqual(servedValue(served[field]));
  }
  expect(indexed?.name).toBe(served.name);
  expect(servedValue(indexed?.shortDescription)).toEqual(
    servedValue(servedResearchEntitySearchCopy(row, servedLead).shortDescription),
  );
  return indexed;
};

describe('search index copy is the served copy (#6390)', () => {
  it('indexes the revoiced description a student reads, not the stored first person', () => {
    const indexed = expectIndexedCopyToMatchServed(
      labRow({
        shortDescription: 'I study how predator populations respond to habitat loss.',
        fullDescription:
          'I study how predator populations respond to habitat loss. My group builds stochastic models of food webs and tests them against long-term field surveys.',
      }),
      { leadMemberNames: ['Orrin Vaskel'] },
    );
    expect(String(indexed?.fullDescription)).not.toMatch(/^I study/);
  });

  it('drops a method chip that repeats a served topic, as the card does', () => {
    const indexed = expectIndexedCopyToMatchServed(
      labRow({
        shortDescription:
          'The lab models how predator populations respond to habitat fragmentation.',
        methods: ['Ecology', 'Stochastic Modeling', 'Field Surveys'],
      }),
    );
    expect(indexed?.methods).not.toContain('Ecology');
  });

  it('matches the served copy when the lead read names the record lead', () => {
    expectIndexedCopyToMatchServed(
      labRow({
        shortDescription:
          'The Quillfeather lab studies predator and prey dynamics in fragmented forests.',
        fullDescription:
          'The Quillfeather lab studies predator and prey dynamics in fragmented forests, combining stochastic models with long-term field surveys across three sites.',
      }),
      { leadMemberNames: ['Orrin Vaskel'], identityLeadDirectsOrganization: false },
    );
  });

  it('matches the served copy for a row with no lead names', () => {
    expectIndexedCopyToMatchServed(
      labRow({
        shortDescription: 'The lab studies predator and prey dynamics in fragmented forests.',
      }),
    );
  });

  it('does not index the topic-summary card as prose', () => {
    const indexed = buildResearchEntitySearchIndexDocument(labRow({}));
    expect(indexed?.shortDescription).toBeUndefined();
  });
});
