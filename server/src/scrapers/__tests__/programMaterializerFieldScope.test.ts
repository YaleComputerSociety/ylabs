import { describe, expect, it } from 'vitest';
import { Fellowship } from '../../models/fellowship';
import {
  parseProgramOnlyFieldsList,
  PROGRAM_MATERIALIZER_DENIED_FIELDS,
  PROGRAM_MATERIALIZER_SCOPE_FIELDS,
  unclassifiedFellowshipSchemaPaths,
} from '../programMaterializerFieldScope';
import { parseUserOnlyFieldsList } from '../userMaterializerFieldScope';

describe('--only-program-fields parsing (#6473)', () => {
  it('accepts observation fields, trims and dedupes them', () => {
    expect(parseProgramOnlyFieldsList(' contactOffice, deadline,contactOffice ')).toEqual([
      'contactOffice',
      'deadline',
    ]);
  });

  it('reads a program title as the program field, not the user profile alias', () => {
    expect(parseProgramOnlyFieldsList('title')).toEqual(['title']);
    expect(parseUserOnlyFieldsList('title')).toEqual(['profile.title']);
  });

  it('fails closed on an unknown field and lists the valid ones', () => {
    expect(() => parseProgramOnlyFieldsList('contactOffice,notAProgramField')).toThrow(
      /Unsupported --only-program-fields field: notAProgramField\. Supported: .*contactOffice/,
    );
  });

  it.each([
    'studentVisibilityTier',
    'studentVisibilityOverrideTier',
    'studentVisibilityReviewedByNetid',
    'studentVisibilityReasons',
    'upcomingDuplicateWindow',
    'audited',
    'favorites',
    'views',
    'sourceKey',
    'sourceName',
    'archived',
    'sourceLinkHealth',
    '_id',
  ])('refuses %s, which no scoped observation write may set', (field) => {
    expect(() => parseProgramOnlyFieldsList(field)).toThrow(/Unsupported --only-program-fields/);
  });

  it('fails closed on an empty list', () => {
    expect(() => parseProgramOnlyFieldsList(' , ')).toThrow(/at least one field/);
    expect(() => parseProgramOnlyFieldsList(undefined)).toThrow(/comma-separated/);
  });
});

describe('every Fellowship schema path is classified for the program scope (#6473)', () => {
  it('leaves no schema path unclassified, so a new field cannot join the scope unreviewed', () => {
    expect(unclassifiedFellowshipSchemaPaths()).toEqual([]);
  });

  it('classifies no path both ways and names no path the schema lacks', () => {
    const schemaPaths = new Set(Object.keys(Fellowship.schema.paths));
    const denied = Object.keys(PROGRAM_MATERIALIZER_DENIED_FIELDS);
    expect(PROGRAM_MATERIALIZER_SCOPE_FIELDS.filter((field) => denied.includes(field))).toEqual([]);
    expect(
      [...PROGRAM_MATERIALIZER_SCOPE_FIELDS, ...denied].filter((field) => !schemaPaths.has(field)),
    ).toEqual([]);
  });
});
