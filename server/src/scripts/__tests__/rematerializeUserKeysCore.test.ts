import { describe, expect, it } from 'vitest';
import {
  parseRematerializeUserKeysArgs,
  summarizeUserKeyPass,
  userKeysFromJson,
} from '../rematerializeUserKeysCore';

describe('observations:rematerialize-user-keys arguments', () => {
  it('is a dry run by default and requires the confirm flag to apply', () => {
    expect(parseRematerializeUserKeysArgs(['--keys-file=/tmp/k.json'])).toMatchObject({
      apply: false,
      passes: 1,
    });
    expect(() => parseRematerializeUserKeysArgs(['--keys-file=/tmp/k.json', '--apply'])).toThrow(
      /confirm/,
    );
    expect(() => parseRematerializeUserKeysArgs(['--apply'])).toThrow(/keys-file/);
    expect(() =>
      parseRematerializeUserKeysArgs(['--keys-file=/tmp/k.json', '--passes=9']),
    ).toThrow();
  });

  it('reads a JSON array of keys, de-duplicated, and refuses anything else', () => {
    expect(userKeysFromJson('["netid:fx1", " dept:a:fx ", "netid:fx1"]')).toEqual([
      'netid:fx1',
      'dept:a:fx',
    ]);
    expect(() => userKeysFromJson('{"a":1}')).toThrow();
    expect(() => userKeysFromJson('["", "netid:fx1"]')).toThrow();
  });

  it('summarizes a pass by writing keys, fields, skips and errors', () => {
    expect(
      summarizeUserKeyPass(2, [
        { entityKey: 'a', fieldsWritten: 0, plannedPaths: [] },
        { entityKey: 'b', fieldsWritten: 3, plannedPaths: ['profile.title'] },
        { entityKey: 'c', fieldsWritten: 0, plannedPaths: [], skipped: 'office-mailbox-user-key' },
        { entityKey: 'd', fieldsWritten: 0, plannedPaths: [], error: 'x' },
      ]),
    ).toEqual({
      pass: 2,
      keys: 4,
      keysWriting: 1,
      fieldsWritten: 3,
      skipped: { 'office-mailbox-user-key': 1 },
      errors: 1,
    });
  });
});
