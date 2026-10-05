import { describe, expect, it } from 'vitest';
import { OBSERVATION_REFERENCE_SPECS } from '../../scrapers/observationRetention';
import {
  EXTERNAL_READER_REFERENCE_SPECS,
  PURGE_CONFIRM_FLAG,
  UNREAD_DIRECTORY_CONTACT_SELECTORS,
  assertPurgeUnreadDirectoryContactApplyAllowed,
  parsePurgeUnreadDirectoryContactArgs,
} from '../purgeUnreadDirectoryContactObservations';

describe('purge-unread-directory-contact arguments', () => {
  it('is a dry run unless apply is asked for', () => {
    expect(parsePurgeUnreadDirectoryContactArgs([]).apply).toBe(false);
    expect(parsePurgeUnreadDirectoryContactArgs(['--dry-run']).apply).toBe(false);
    expect(parsePurgeUnreadDirectoryContactArgs(['--apply']).apply).toBe(true);
  });

  it('reads an output path in either spelling', () => {
    expect(parsePurgeUnreadDirectoryContactArgs(['--output=/tmp/report.json']).output).toBe(
      '/tmp/report.json',
    );
    expect(parsePurgeUnreadDirectoryContactArgs(['--output', '/tmp/report.json']).output).toBe(
      '/tmp/report.json',
    );
  });

  it('rejects an argument it does not know, rather than ignoring it', () => {
    expect(() => parsePurgeUnreadDirectoryContactArgs(['--field=email'])).toThrow();
  });

  it('refuses to delete without the confirmation flag', () => {
    expect(() =>
      assertPurgeUnreadDirectoryContactApplyAllowed({ apply: true, confirm: false }),
    ).toThrow(PURGE_CONFIRM_FLAG);
    expect(() =>
      assertPurgeUnreadDirectoryContactApplyAllowed({ apply: true, confirm: true }),
    ).not.toThrow();
    expect(() =>
      assertPurgeUnreadDirectoryContactApplyAllowed({ apply: false, confirm: false }),
    ).not.toThrow();
  });
});

describe('purge-unread-directory-contact selection', () => {
  it('names only the directory-lane fields no reader consumes', () => {
    expect(UNREAD_DIRECTORY_CONTACT_SELECTORS).toEqual([
      { field: 'phone', sourceName: 'yale-directory' },
      { field: 'college', sourceName: 'yale-directory' },
      { field: 'physicalLocation', sourceName: 'yale-directory-csv' },
    ]);
  });

  it('protects an observation a served document cites, and not one only its successor cites', () => {
    const specNames = EXTERNAL_READER_REFERENCE_SPECS.map(
      (spec) => `${spec.collection}.${spec.field}`,
    );
    expect(specNames).not.toContain('observations.supersededBy');
    expect(specNames).toContain('research_entities.fieldProvenance');
    expect(specNames).toContain('signals.source.evidenceIds');
    expect(EXTERNAL_READER_REFERENCE_SPECS).toHaveLength(OBSERVATION_REFERENCE_SPECS.length - 1);
  });

  it('cannot be pointed at a field a reader consumes, because the list is not an argument', () => {
    const fields = UNREAD_DIRECTORY_CONTACT_SELECTORS.map((selector) => selector.field);
    for (const readField of ['email', 'netid', 'fname', 'lname', 'title', 'primaryDepartment']) {
      expect(fields).not.toContain(readField);
    }
  });
});
