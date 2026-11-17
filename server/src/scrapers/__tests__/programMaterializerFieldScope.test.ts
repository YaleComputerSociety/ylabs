import { describe, expect, it } from 'vitest';
import {
  parseProgramOnlyFieldsList,
  programMaterializerScopeFields,
} from '../programMaterializerFieldScope';
import { parseUserOnlyFieldsList } from '../userMaterializerFieldScope';

describe('--only-program-fields parsing (#6473)', () => {
  it('accepts Fellowship schema paths, trims and dedupes them', () => {
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

  it('fails closed on an empty list', () => {
    expect(() => parseProgramOnlyFieldsList(' , ')).toThrow(/at least one field/);
    expect(() => parseProgramOnlyFieldsList(undefined)).toThrow(/comma-separated/);
  });

  it('offers no internal bookkeeping path', () => {
    const fields = programMaterializerScopeFields();
    expect(fields).toContain('contactOffice');
    expect(fields).not.toContain('_id');
    expect(fields).not.toContain('__v');
  });
});
