import { describe, expect, it } from 'vitest';
import {
  buildWebsiteUrlResearchEntityDedupePlan,
  groupEntitiesByWebsiteUrlIdentity,
  type ResearchEntityPiDedupeRow,
} from '../researchEntityPiDedupeCore';
import { redirectLandingIdentityKeys } from '../../utils/websiteUrlIdentityKey';

type Entity = ResearchEntityPiDedupeRow['entities'][number];

const OLD_HOME = 'http://quill.commons.example.edu/';
const NEW_HOME = 'https://press.example.edu/quill/';
const landings = redirectLandingIdentityKeys([{ url: OLD_HOME, redirectLandingUrl: NEW_HOME }]);

const profile = (overrides: Partial<Entity> & { id: string; websiteUrl: string }): Entity => ({
  slug: overrides.id,
  name: 'Ada Quill Faculty Research',
  kind: 'faculty_research_area',
  entityType: 'FACULTY_RESEARCH_AREA',
  sourceUrls: [],
  departments: [],
  researchAreas: [],
  ...overrides,
});

const planFor = (entities: Entity[]) =>
  buildWebsiteUrlResearchEntityDedupePlan(groupEntitiesByWebsiteUrlIdentity(entities, landings));

const twoProfiles = (firstLeads: string[], secondLeads: string[]): Entity[] => [
  profile({
    id: 'dept-one-ada-quill',
    websiteUrl: OLD_HOME,
    leadPersonIds: firstLeads,
    sourceUrls: ['https://one.example.edu/people/ada-quill', OLD_HOME],
  }),
  profile({
    id: 'dept-two-ada-quill',
    websiteUrl: NEW_HOME,
    leadPersonIds: secondLeads,
    sourceUrls: ['https://two.example.edu/directory/ada-quill', NEW_HOME],
  }),
];

describe('website-url lane distinct-lead guard (#5638)', () => {
  it('refuses two person-led rows whose lead edges name different researcher ids', () => {
    expect(planFor(twoProfiles(['researcher-1'], ['researcher-2']))).toEqual([]);
  });

  it('still merges rows that share one lead researcher id', () => {
    const plan = planFor(twoProfiles(['researcher-1'], ['researcher-1']));
    expect(plan).toHaveLength(1);
    expect([plan[0].canonicalEntityId, ...plan[0].duplicateEntityIds].sort()).toEqual([
      'dept-one-ada-quill',
      'dept-two-ada-quill',
    ]);
  });

  it('still merges when only one row carries a lead edge', () => {
    expect(planFor(twoProfiles(['researcher-1'], []))).toHaveLength(1);
    expect(planFor(twoProfiles([], ['researcher-1']))).toHaveLength(1);
  });

  it('still merges rows with no person lead at all', () => {
    expect(planFor(twoProfiles([], []))).toHaveLength(1);
  });

  it('refuses a leadless survivor collecting different researcher ids from two duplicates', () => {
    const entities: Entity[] = [
      profile({
        id: 'dept-zero-ada-quill',
        websiteUrl: OLD_HOME,
        sourceUrls: [
          OLD_HOME,
          NEW_HOME,
          'https://zero.example.edu/a',
          'https://zero.example.edu/b',
        ],
      }),
      ...twoProfiles(['researcher-1'], ['researcher-2']),
    ];
    expect(planFor(entities)).toEqual([]);
  });

  it('merges a leadless survivor with two duplicates sharing one researcher id', () => {
    const entities: Entity[] = [
      profile({
        id: 'dept-zero-ada-quill',
        websiteUrl: OLD_HOME,
        sourceUrls: [
          OLD_HOME,
          NEW_HOME,
          'https://zero.example.edu/a',
          'https://zero.example.edu/b',
        ],
      }),
      ...twoProfiles(['researcher-1'], ['researcher-1']),
    ];
    const plan = planFor(entities);
    expect(plan).toHaveLength(1);
    expect(plan[0].duplicateEntityIds).toHaveLength(2);
  });

  it('still drops a member whose slug names another person when it shares a lead id', () => {
    const entities: Entity[] = [
      ...twoProfiles(['researcher-1'], ['researcher-1']),
      profile({
        id: 'dept-three-bo-lark',
        websiteUrl: NEW_HOME,
        leadPersonIds: ['researcher-1'],
      }),
    ];
    const plan = planFor(entities);
    expect(plan).toHaveLength(1);
    expect([plan[0].canonicalEntityId, ...plan[0].duplicateEntityIds].sort()).toEqual([
      'dept-one-ada-quill',
      'dept-two-ada-quill',
    ]);
  });
});
