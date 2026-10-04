import { describe, expect, it } from 'vitest';
import { planSamePersonArchiveTombstones } from '../tombstoneSamePersonArchivesCore';

const row = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${slug}`,
  slug,
  archived: false,
  entityType: 'FACULTY_RESEARCH_AREA',
  ...extra,
});

describe('planSamePersonArchiveTombstones (#4696)', () => {
  it('points an unpointed person-scoped archive at the one live row its lead reaches', () => {
    const plan = planSamePersonArchiveTombstones({
      rows: [row('roster-a-lead'), row('roster-b-lead', { archived: true })],
      leadKeysBySlug: new Map([
        ['roster-a-lead', ['netid:example.lead']],
        ['roster-b-lead', ['netid:example.lead']],
      ]),
    });
    expect(plan.tombstones).toEqual([
      {
        archivedId: 'id-roster-b-lead',
        archivedSlug: 'roster-b-lead',
        survivorId: 'id-roster-a-lead',
        survivorSlug: 'roster-a-lead',
      },
    ]);
  });

  it('leaves an archive that already records a reason or a survivor alone', () => {
    const plan = planSamePersonArchiveTombstones({
      rows: [
        row('live-lead'),
        row('reasoned', { archived: true, archivedReason: 'operator judgement' }),
        row('pointed', { archived: true, canonicalGroupId: 'id-live-lead' }),
      ],
      leadKeysBySlug: new Map([
        ['live-lead', ['netid:example.lead']],
        ['reasoned', ['netid:example.lead']],
        ['pointed', ['netid:example.lead']],
      ]),
    });
    expect(plan.tombstones).toEqual([]);
    expect(plan.held).toEqual([]);
  });

  it('holds a program archive and an archive whose lead reaches several live rows', () => {
    const plan = planSamePersonArchiveTombstones({
      rows: [
        row('lab-one'),
        row('lab-two'),
        row('ambiguous', { archived: true }),
        row('program', { archived: true, entityType: 'PROGRAM' }),
      ],
      leadKeysBySlug: new Map([
        ['lab-one', ['netid:example.lead']],
        ['lab-two', ['netid:example.lead']],
        ['ambiguous', ['netid:example.lead']],
        ['program', ['netid:example.lead']],
      ]),
    });
    expect(plan.tombstones).toEqual([]);
    expect(plan.held).toEqual([
      { slug: 'ambiguous', reason: 'several-live-rows-for-the-lead' },
      { slug: 'program', reason: 'not-person-scoped' },
    ]);
  });
});
