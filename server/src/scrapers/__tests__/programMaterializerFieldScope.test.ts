import { describe, expect, it } from 'vitest';
import { Fellowship } from '../../models/fellowship';
import {
  parseProgramOnlyFieldsList,
  PROGRAM_MATERIALIZER_DENIED_FIELDS,
  PROGRAM_MATERIALIZER_SCOPE_FIELDS,
  unclassifiedFellowshipSchemaPaths,
} from '../programMaterializerFieldScope';
import { parseUserOnlyFieldsList } from '../userMaterializerFieldScope';
import {
  PROGRAM_REGATE_TRIGGER_FIELDS,
  programFieldScopeRegateFields,
} from '../programMaterializerFieldScope';
import {
  DUPLICATE_PROGRAM_COPY_INPUT_FIELDS,
  duplicateProgramCopyCandidate,
  upcomingDuplicateWindowCandidate,
} from '../../services/studentVisibilityGateService';
import { PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS } from '../../services/studentVisibilityTier';

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

describe('a field-scoped program write re-gates only when the gate reads a named field (#6473)', () => {
  it('re-gates for a field the tier function reads', () => {
    expect(programFieldScopeRegateFields(['deadline', 'awardAmount'])).toEqual(['deadline']);
  });

  it('does not re-gate when no named field is read by the gate or the duplicate loader', () => {
    expect(programFieldScopeRegateFields(['awardAmount', 'contactEmail', 'hoursPerWeek'])).toEqual(
      [],
    );
  });

  it('covers every field the duplicate-copy selection reads, so a kept copy cannot change unseen', () => {
    expect(
      DUPLICATE_PROGRAM_COPY_INPUT_FIELDS.filter(
        (field) => !PROGRAM_REGATE_TRIGGER_FIELDS.has(field),
      ),
    ).toEqual([]);
  });

  it('covers every field the tier function reads', () => {
    expect(
      PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS.filter(
        (field) => !PROGRAM_REGATE_TRIGGER_FIELDS.has(field),
      ),
    ).toEqual([]);
  });

  it.each(['duplicateProgramCopyCandidate', 'upcomingDuplicateWindowCandidate'] as const)(
    '%s reads no program field outside the duplicate list',
    (builder) => {
      const reads = new Set<string>();
      const program = new Proxy(
        {},
        {
          get(target, key, receiver) {
            if (typeof key === 'string') reads.add(key);
            return Reflect.get(target, key, receiver);
          },
        },
      );
      const build = { duplicateProgramCopyCandidate, upcomingDuplicateWindowCandidate }[builder];
      build(program, 'fixture-id', 'student_ready');
      const listed = new Set<string>(DUPLICATE_PROGRAM_COPY_INPUT_FIELDS);
      expect([...reads].filter((field) => !listed.has(field))).toEqual([]);
    },
  );
});
