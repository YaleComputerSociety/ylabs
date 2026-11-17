import { describe, expect, it } from 'vitest';
import { settleMergedSurvivor } from '../mergeSameLeadSurvivorScope';
import { createChunkedRegater } from '../rematerializeResearchEntitiesCore';
import {
  researcherIdsWrittenBy,
  visitUserKeysRegatingLinkedRows,
  type UserKeyPassRow,
} from '../rematerializeUserKeysCore';

const recordingRegater = (events: string[]) =>
  createChunkedRegater(async (ids: string[]) => {
    events.push(`regate:${ids.join(',')}`);
    return ids.length;
  }, 1);

describe('merge-same-lead re-gates each survivor before the next merge (#6374)', () => {
  it('re-materializes the survivor, then re-gates it', async () => {
    const events: string[] = [];
    const regater = recordingRegater(events);
    for (const survivor of [
      { _id: 'survivor-one', slug: 'orrery-survivor-lab' },
      { _id: 'survivor-two', slug: 'quasar-survivor-lab' },
    ]) {
      await settleMergedSurvivor({
        survivor,
        onlyFields: ['recentGrants'],
        materialize: async (_type, key) => {
          events.push(`materialize:${key.entityKey}`);
          return {};
        },
        regater,
      });
    }
    await regater.finish();
    expect(events).toEqual([
      'materialize:orrery-survivor-lab',
      'materialize:orrery-survivor-lab',
      'regate:survivor-one',
      'materialize:quasar-survivor-lab',
      'materialize:quasar-survivor-lab',
      'regate:survivor-two',
    ]);
  });
});

describe('rematerialize-user-keys re-gates the research rows linked to a written person (#6374)', () => {
  const row = (entityKey: string, overrides: Partial<UserKeyPassRow> = {}): UserKeyPassRow => ({
    entityKey,
    fieldsWritten: 0,
    plannedPaths: [],
    ...overrides,
  });

  it('takes only the researchers a visit actually wrote', () => {
    expect(
      researcherIdsWrittenBy([
        row('netid:wrote', { researcherId: 'person-a', fieldsWritten: 2 }),
        row('netid:unchanged', { researcherId: 'person-b' }),
        row('netid:failed', { researcherId: 'person-c', fieldsWritten: 1, error: 'boom' }),
        row('netid:unjoined', { fieldsWritten: 1 }),
        row('netid:again', { researcherId: 'person-a', fieldsWritten: 1 }),
      ]),
    ).toEqual(['person-a']);
  });

  it("re-gates a written person's linked rows before visiting the next key", async () => {
    const events: string[] = [];
    const regater = recordingRegater(events);
    const visits: Record<string, UserKeyPassRow> = {
      'netid:first': row('netid:first', { researcherId: 'person-a', fieldsWritten: 1 }),
      'netid:second': row('netid:second', { researcherId: 'person-b' }),
      'netid:third': row('netid:third', { researcherId: 'person-c', fieldsWritten: 1 }),
    };
    const linked: Record<string, string[]> = {
      'person-a': ['lab-a'],
      'person-b': ['lab-b'],
      'person-c': ['lab-c', 'center-c'],
    };

    const rows = await visitUserKeysRegatingLinkedRows({
      keys: Object.keys(visits),
      visit: async (key) => {
        events.push(`visit:${key}`);
        return visits[key];
      },
      linkedResearchEntityIds: async (ids) => ids.flatMap((id) => linked[id] ?? []),
      regater,
    });
    await regater.finish();

    expect(rows.map((entry) => entry.entityKey)).toEqual(Object.keys(visits));
    expect(events).toEqual([
      'visit:netid:first',
      'regate:lab-a',
      'visit:netid:second',
      'visit:netid:third',
      'regate:lab-c',
      'regate:center-c',
    ]);
  });

  it('re-gates nothing on a dry run', async () => {
    let lookups = 0;
    await visitUserKeysRegatingLinkedRows({
      keys: ['netid:first'],
      visit: async () => row('netid:first', { researcherId: 'person-a', fieldsWritten: 1 }),
      linkedResearchEntityIds: async () => {
        lookups += 1;
        return ['lab-a'];
      },
    });
    expect(lookups).toBe(0);
  });
});
