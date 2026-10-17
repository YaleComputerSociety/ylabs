import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
  relationshipTargetIdentities,
} from '../centerRelationshipTarget';

describe('relationshipTargetIdentities', () => {
  it('yields one identity per site a relationship was observed with, whatever the row order', () => {
    const rows = [
      { entityKey: 'center:member', field: 'targetEntityKey', value: 'member-target' },
      {
        entityKey: 'center:member',
        field: RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
        value: 'https://new.example.test',
      },
      {
        entityKey: 'center:member',
        field: RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
        value: 'https://old.example.test',
      },
    ];
    const expected = [
      { targetEntityKey: 'member-target', targetWebsiteUrl: 'https://new.example.test' },
      { targetEntityKey: 'member-target', targetWebsiteUrl: 'https://old.example.test' },
    ];

    expect(relationshipTargetIdentities(rows)).toEqual(expect.arrayContaining(expected));
    expect(relationshipTargetIdentities([...rows].reverse())).toEqual(
      expect.arrayContaining(expected),
    );
    expect(relationshipTargetIdentities(rows)).toHaveLength(2);
  });

  it('yields a key-only identity when no site was observed', () => {
    expect(
      relationshipTargetIdentities([
        { entityKey: 'center:member', field: 'targetEntityKey', value: 'member-target' },
      ]),
    ).toEqual([{ targetEntityKey: 'member-target' }]);
  });

  it('skips a relationship observed only through a site', () => {
    expect(
      relationshipTargetIdentities([
        {
          entityKey: 'center:member',
          field: RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
          value: 'https://site.example.test',
        },
      ]),
    ).toEqual([]);
  });
});
