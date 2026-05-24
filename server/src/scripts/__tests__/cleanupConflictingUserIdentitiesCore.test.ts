import { describe, expect, test } from 'vitest';
import { buildConflictingUserIdentityCleanupPlan } from '../cleanupConflictingUserIdentitiesCore';

describe('buildConflictingUserIdentityCleanupPlan', () => {
  test('clears external identities shared by different people', () => {
    const plan = buildConflictingUserIdentityCleanupPlan([
      {
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/A123',
        users: [
          { id: 'u1', fname: 'Alpha', lname: 'Fixture', openAlexId: 'https://openalex.org/A123' },
          { id: 'u2', fname: 'Beta', lname: 'Fixture', openAlexId: 'https://openalex.org/A123' },
        ],
      },
    ]);

    expect(plan.cleanupUsers).toHaveLength(2);
    expect(plan.cleanupUsers).toEqual([
      expect.objectContaining({
        userId: 'u1',
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/A123',
        unsetFields: ['openAlexId', 'openAlexWorksSyncedAt'],
      }),
      expect.objectContaining({
        userId: 'u2',
        identityField: 'openAlexId',
        identityValue: 'https://openalex.org/A123',
        unsetFields: ['openAlexId', 'openAlexWorksSyncedAt'],
      }),
    ]);
  });

  test('replaces conflicting email identities with netid fallback emails', () => {
    const plan = buildConflictingUserIdentityCleanupPlan([
      {
        identityField: 'email',
        identityValue: 'shared.editor@example.test',
        users: [
          {
            id: 'u1',
            netid: 'aa1001',
            fname: 'Alpha',
            lname: 'Editor',
            email: 'shared.editor@example.test',
          },
          {
            id: 'u2',
            netid: 'bb2002',
            fname: 'Beta',
            lname: 'Editor',
            email: 'shared.editor@example.test',
          },
        ],
      },
    ]);

    expect(plan.cleanupUsers).toHaveLength(2);
    expect(plan.cleanupUsers).toEqual([
      expect.objectContaining({
        userId: 'u1',
        identityField: 'email',
        identityValue: 'shared.editor@example.test',
        replacementValue: 'aa1001@yale.edu',
      }),
      expect.objectContaining({
        userId: 'u2',
        identityField: 'email',
        identityValue: 'shared.editor@example.test',
        replacementValue: 'bb2002@yale.edu',
      }),
    ]);
  });

  test('does not clean same-name duplicates that the dedupe command can merge', () => {
    const plan = buildConflictingUserIdentityCleanupPlan([
      {
        identityField: 'email',
        identityValue: 'same.person@example.test',
        users: [
          {
            id: 'u1',
            netid: 'sp1001',
            fname: 'Same',
            lname: 'Fixture',
            email: 'same.person@example.test',
          },
          {
            id: 'u2',
            netid: 'sp2002',
            fname: 'Same',
            lname: 'Fixture',
            email: 'same.person@example.test',
          },
        ],
      },
    ]);

    expect(plan.cleanupUsers).toEqual([]);
    expect(plan.skippedSameNameGroups).toBe(1);
  });
});
