import { describe, expect, it } from 'vitest';
import {
  buildNameAgreedSharedPersonAndRosterMailboxDedupePlan,
  partitionPlanByPersonProfileConflation,
  type ResearchEntityPiDedupeRow,
} from '../researchEntityPiDedupeCore';

type Entity = ResearchEntityPiDedupeRow['entities'][number];

const fra = (id: string, name: string, extra: Partial<Entity> = {}): Entity => ({
  id,
  slug: id,
  name,
  entityType: 'FACULTY_RESEARCH_AREA',
  ...extra,
});

const leadRow = (userId: string, entities: Entity[]): ResearchEntityPiDedupeRow => ({
  userId,
  normalizedName: `same-pi:${userId}`,
  entities,
});

const mailboxRow = (key: string, entities: Entity[]): ResearchEntityPiDedupeRow => ({
  userId: `roster-mailbox:${key}`,
  normalizedName: `roster-mailbox:${key}`,
  entities,
});

const members = (groups: Array<{ canonicalEntityId: string; duplicateEntityIds: string[] }>) =>
  groups.map((group) => [group.canonicalEntityId, ...group.duplicateEntityIds].sort());

describe('name-agreed dedupe over roster mailbox groups (#5969)', () => {
  it('merges one person’s rows on two rosters whose leads resolved to two researchers', () => {
    const onAlpha = fra('dept-synthetic-alpha-ada-alpha', 'Ada Alpha Faculty Research');
    const onBeta = fra('dept-synthetic-beta-ada-alpha', 'Ada Alpha Faculty Research');
    const leadsOnly = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [leadRow('researcher-1', [onAlpha]), leadRow('researcher-2', [onBeta])],
      [],
    );
    expect(leadsOnly).toEqual([]);
    const plan = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [leadRow('researcher-1', [onAlpha]), leadRow('researcher-2', [onBeta])],
      [mailboxRow('netid:ada.alpha', [onAlpha, onBeta])],
    );
    expect(members(plan)).toEqual([[onAlpha.id, onBeta.id].sort()]);
  });

  it('keeps the name-agreement guard on mailbox groups', () => {
    const plan = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [],
      [
        mailboxRow('netid:ada.alpha', [
          fra('dept-synthetic-alpha-ada-alpha', 'Ada Alpha Faculty Research'),
          fra('dept-synthetic-beta-ada-alpha', 'Coastal Sediment Dynamics'),
        ]),
      ],
    );
    expect(plan).toEqual([]);
  });

  it('never plans a row twice when a lead group already holds it', () => {
    const a = fra('dept-synthetic-alpha-ada-alpha', 'Ada Alpha Faculty Research');
    const b = fra('faculty-research-area-ada-alpha', 'Ada Alpha Faculty Research');
    const c = fra('dept-synthetic-beta-ada-alpha', 'Ada Alpha Faculty Research');
    const plan = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [leadRow('researcher-1', [a, b])],
      [mailboxRow('netid:ada.alpha', [a, c])],
    );
    expect(members(plan)).toEqual([[a.id, b.id].sort()]);
  });

  it('a shared lead id alone does not merge two different people’s rows', () => {
    const plan = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [
        leadRow('researcher-1', [
          fra('ysm-faculty-ada-alpha', 'Ada Alpha Faculty Research'),
          fra('ysm-faculty-bram-orlo', 'Bram Orlo Faculty Research'),
        ]),
      ],
      [],
    );
    expect(plan).toEqual([]);
  });

  it('a shared lead id on two namesakes is quarantined by their distinct profiles', () => {
    const plan = buildNameAgreedSharedPersonAndRosterMailboxDedupePlan(
      [
        leadRow('researcher-1', [
          fra('ysm-faculty-ada-alpha', 'Ada Q. Alpha Faculty Research', {
            sourceUrls: ['https://medicine.yale.edu/profile/ada-alpha/'],
          }),
          fra('dept-som-ada-r-alpha', 'Ada R. Alpha Faculty Research', {
            sourceUrls: ['https://som.yale.edu/profile/ada-alpha-quill/'],
          }),
        ]),
      ],
      [],
    );
    expect(plan).toHaveLength(1);
    const { plan: kept, quarantine } = partitionPlanByPersonProfileConflation(plan);
    expect(kept).toEqual([]);
    expect(quarantine).toHaveLength(1);
  });
});
