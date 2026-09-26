import { describe, expect, it } from 'vitest';
import {
  PROFILE_PAGE_JOIN_CONFIRM_FLAG,
  classifyProfilePageJoinOutcome,
  parseMaterializeProfilePageJoinedUsersArgs,
  summarizeProfilePageJoinRows,
  type ProfilePageJoinRow,
} from '../materializeProfilePageJoinedUsersCore';

describe('materializeProfilePageJoinedUsersCore', () => {
  describe('argument parsing', () => {
    it('defaults to a dry run', () => {
      expect(parseMaterializeProfilePageJoinedUsersArgs([])).toEqual({
        apply: false,
        confirmed: false,
      });
    });

    it('refuses --apply without the confirm flag', () => {
      expect(() => parseMaterializeProfilePageJoinedUsersArgs(['--apply'])).toThrow(
        PROFILE_PAGE_JOIN_CONFIRM_FLAG,
      );
    });

    it('accepts --apply with the confirm flag', () => {
      const args = parseMaterializeProfilePageJoinedUsersArgs([
        '--apply',
        PROFILE_PAGE_JOIN_CONFIRM_FLAG,
        '--limit=5',
      ]);
      expect(args).toEqual({ apply: true, confirmed: true, limit: 5 });
    });
  });

  describe('outcome classification reads the engine report, never a local guess', () => {
    it('treats a skip as unreachable whatever else the result carries', () => {
      expect(
        classifyProfilePageJoinOutcome(
          { skipped: 'directory-identity-without-research-signal', fieldsWritten: 0 },
          { apply: true },
        ),
      ).toBe('unreachable');
    });

    it('excludes a key another join reached, so the apply set stays scoped to this fix', () => {
      expect(
        classifyProfilePageJoinOutcome(
          { identityJoin: 'person-name', fieldsWritten: 3 },
          { apply: true },
        ),
      ).toBe('reached-by-another-join');
      expect(
        classifyProfilePageJoinOutcome(
          { identityJoin: 'account-netid', fieldsWritten: 3 },
          { apply: true },
        ),
      ).toBe('reached-by-another-join');
    });

    it('never claims a write in dry run, however many fields are planned', () => {
      expect(
        classifyProfilePageJoinOutcome(
          { identityJoin: 'official-profile-page', fieldsWritten: 4 },
          { apply: false },
        ),
      ).toBe('joined-only-in-dry-run');
    });

    it('separates a join that wrote from a join that found nothing to add', () => {
      expect(
        classifyProfilePageJoinOutcome(
          { identityJoin: 'official-profile-page', fieldsWritten: 4 },
          { apply: true },
        ),
      ).toBe('joined-and-enriched');
      expect(
        classifyProfilePageJoinOutcome(
          { identityJoin: 'official-profile-page', fieldsWritten: 0 },
          { apply: true },
        ),
      ).toBe('joined-no-change');
    });

    it('classifies a result with no identityJoin at all as reached by another join', () => {
      expect(classifyProfilePageJoinOutcome({ fieldsWritten: 0 }, { apply: true })).toBe(
        'reached-by-another-join',
      );
    });
  });

  describe('summary', () => {
    it('counts every outcome and de-duplicates the people reached', () => {
      const rows: ProfilePageJoinRow[] = [
        {
          entityKey: 'a',
          outcome: 'joined-and-enriched',
          fieldsWritten: 3,
          researcherId: 'person-1',
        },
        {
          entityKey: 'b',
          outcome: 'joined-and-enriched',
          fieldsWritten: 2,
          researcherId: 'person-1',
        },
        { entityKey: 'c', outcome: 'unreachable', fieldsWritten: 0 },
      ];

      const summary = summarizeProfilePageJoinRows(rows);

      expect(summary.outcomes['joined-and-enriched']).toBe(2);
      expect(summary.outcomes.unreachable).toBe(1);
      expect(summary.outcomes['joined-no-change']).toBe(0);
      expect(summary.fieldsWritten).toBe(5);
      expect(summary.distinctResearchers).toBe(1);
    });
  });
});
