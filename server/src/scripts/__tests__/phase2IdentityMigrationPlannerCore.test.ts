import { describe, expect, it } from 'vitest';
import {
  buildPhase2IdentityMigrationPlan,
  collectPhase2ProfileUrlValues,
  MAX_PHASE2_PROFILE_URL_NODES,
  MAX_PHASE2_PROFILE_URL_QUEUE,
  MAX_PHASE2_PROFILE_URL_STRINGS,
  type Phase2IdentityMigrationPlannerInput,
} from '../phase2IdentityMigrationPlannerCore';

function input(
  overrides: Partial<Phase2IdentityMigrationPlannerInput> = {},
): Phase2IdentityMigrationPlannerInput {
  const memberships = overrides.memberships || [];
  return {
    users: [],
    facultyMembers: [],
    memberships,
    knownResearchEntityIds: memberships.flatMap(({ researchEntityId, researchGroupId }) => {
      const targetId = researchEntityId || researchGroupId;
      return targetId ? [targetId] : [];
    }),
    environment: 'development',
    databaseName: 'Development',
    sourceCommit: 'a'.repeat(40),
    limits: {
      documentsPerCollection: 100,
      quarantineRecords: 100,
    },
    truncation: {
      users: false,
      facultyMembers: false,
      memberships: false,
      researchEntities: false,
    },
    generatedAt: '2026-07-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildPhase2IdentityMigrationPlan', () => {
  it('plans one Account, Person, and approved current role from explicit canonical references', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        users: [
          {
            id: 'user-1',
            netid: 'person-one',
            email: 'person.one@yale.edu',
            userType: 'professor',
            fname: 'Person',
            lname: 'One',
            userConfirmed: true,
            facultyMemberId: 'faculty-1',
          },
        ],
        facultyMembers: [
          {
            id: 'faculty-1',
            userId: 'user-1',
            netid: 'person-one',
            email: 'person.one@yale.edu',
            name: 'Person One',
            websiteUrl: 'https://example.yale.edu/profile/person-one/',
            orcidId: '0000-0001-2345-6789',
          },
        ],
        memberships: [
          {
            id: 'membership-1',
            researchEntityId: 'entity-1',
            userId: 'user-1',
            facultyMemberId: 'faculty-1',
            name: 'Person One',
            role: 'pi',
            isCurrentMember: true,
            evidenceStatus: 'verified',
            confidence: 0.9,
          },
        ],
      }),
    );

    expect(report.policy).toEqual({
      createsPeopleFromExternalIdentityAlone: false,
      mergesPeopleOnNameAlone: false,
      usesExternalIdentifiersAsMergeKeys: false,
      redirectsRuntimeReaders: false,
      writesCanonicalCollections: false,
    });
    expect(report.plannedAccounts).toEqual([
      {
        accountKey: 'account:user:user-1',
        sourceUserId: 'user-1',
        netid: 'person-one',
        email: 'person.one@yale.edu',
        status: 'ACTIVE',
      },
    ]);
    expect(report.plannedPeople).toEqual([
      {
        personKey: 'person:user:user-1',
        sourceUserIds: ['user-1'],
        sourceFacultyMemberIds: ['faculty-1'],
        displayName: 'Person One',
        accountKey: 'account:user:user-1',
        yaleEvidence: ['NETID', 'YALE_EMAIL'],
        externalIdentityHints: ['ORCID'],
        unverifiedYaleProfileHints: ['https://example.yale.edu/profile/person-one'],
      },
    ]);
    expect(report.plannedRoleAssignments).toEqual([
      {
        roleAssignmentKey: 'role_assignment:membership:membership-1',
        sourceMembershipId: 'membership-1',
        personKey: 'person:user:user-1',
        researchEntityId: 'entity-1',
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
        reviewStatus: 'APPROVED',
        resolution: 'CANONICAL_SOURCE_REFERENCE',
      },
    ]);
    expect(report.quarantine).toEqual([]);
  });

  it('never creates a Person from an external identifier alone', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-external',
            name: 'External Only',
            googleScholarId: 'synthetic_profile_id',
          },
        ],
      }),
    );

    expect(report.plannedPeople).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'identity_component',
      subjectIds: ['faculty_member:faculty-external'],
      reasons: ['external_identity_only'],
    });
  });

  it.each([
    {
      label: 'shared ORCID',
      externalField: 'orcidId',
      externalValue: '0000-0001-2345-6789',
      yaleIdentity: { netid: 'yale-orcid-person' },
      yaleEvidence: ['NETID'],
      externalHint: 'ORCID',
    },
    {
      label: 'shared Google Scholar identifier',
      externalField: 'googleScholarId',
      externalValue: 'scholar-bridge-id',
      yaleIdentity: { email: 'yale.scholar.person@yale.edu' },
      yaleEvidence: ['YALE_EMAIL'],
      externalHint: 'GOOGLE_SCHOLAR',
    },
  ] as const)(
    'does not use $label to bridge an external-only row or approve its membership',
    ({ externalField, externalValue, yaleIdentity, yaleEvidence, externalHint }) => {
      const facultyMembers: Phase2IdentityMigrationPlannerInput['facultyMembers'] = [
        {
          id: 'faculty-yale-identity',
          name: 'Yale Identity',
          ...yaleIdentity,
          [externalField]: externalValue,
        },
        {
          id: 'faculty-external-only',
          name: 'External Identity',
          [externalField]: externalValue,
        },
      ];
      const memberships: Phase2IdentityMigrationPlannerInput['memberships'] = [
        {
          id: 'membership-external-only',
          researchEntityId: 'entity-external-only',
          facultyMemberId: 'faculty-external-only',
          name: 'External Identity',
          role: 'pi',
          isCurrentMember: true,
          evidenceStatus: 'verified',
          confidence: 0.95,
        },
      ];
      const report = buildPhase2IdentityMigrationPlan(input({ facultyMembers, memberships }));
      const reversedReport = buildPhase2IdentityMigrationPlan(
        input({ facultyMembers: [...facultyMembers].reverse(), memberships }),
      );

      expect(report.plannedPeople).toEqual([
        expect.objectContaining({
          sourceFacultyMemberIds: ['faculty-yale-identity'],
          yaleEvidence,
          externalIdentityHints: [externalHint],
        }),
      ]);
      expect(report.quarantine).toContainEqual({
        subjectType: 'identity_component',
        subjectIds: ['faculty_member:faculty-external-only'],
        reasons: ['external_identity_only'],
      });
      expect(report.quarantine).toContainEqual({
        subjectType: 'membership',
        subjectIds: ['membership-external-only'],
        reasons: ['membership_missing_person'],
      });
      expect(report.plannedRoleAssignments).toEqual([]);
      expect(reversedReport).toEqual(report);
    },
  );

  it.each([
    [
      'ORCID',
      'orcid',
      'orcidId',
      '9999-9999-9999-9994',
      '1111-1111-1111-1115',
      'conflicting_orcid',
    ],
    [
      'Google Scholar identifier',
      'googleScholarId',
      'googleScholarId',
      'scholar-id-a',
      'scholar-id-b',
      'conflicting_google_scholar_id',
    ],
  ] as const)(
    'still quarantines conflicting %s values inside an explicitly linked component',
    (_label, userField, facultyField, userValue, facultyValue, reason) => {
      const report = buildPhase2IdentityMigrationPlan(
        input({
          users: [
            {
              id: 'user-explicit-link',
              netid: 'explicit-link',
              email: 'fixture.explicit.link@yale.edu',
              userType: 'professor',
              fname: 'Explicit',
              lname: 'Link',
              userConfirmed: true,
              facultyMemberId: 'faculty-explicit-link',
              [userField]: userValue,
            },
          ],
          facultyMembers: [
            {
              id: 'faculty-explicit-link',
              userId: 'user-explicit-link',
              netid: 'explicit-link',
              email: 'fixture.explicit.link@yale.edu',
              name: 'Explicit Link',
              [facultyField]: facultyValue,
            },
          ],
        }),
      );

      expect(report.plannedPeople).toEqual([]);
      expect(report.quarantine).toContainEqual({
        subjectType: 'identity_component',
        subjectIds: ['faculty_member:faculty-explicit-link', 'user:user-explicit-link'],
        reasons: [reason],
      });
    },
  );

  it('quarantines distinct Yale identities that share only a name', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-a',
            name: 'Shared Name',
            netid: 'shared-a',
          },
          {
            id: 'faculty-b',
            name: 'Shared Name',
            netid: 'shared-b',
          },
        ],
      }),
    );

    expect(report.plannedPeople).toEqual([]);
    expect(report.quarantine).toEqual([
      {
        subjectType: 'identity_component',
        subjectIds: ['faculty_member:faculty-a'],
        reasons: ['same_name_distinct_identity'],
      },
      {
        subjectType: 'identity_component',
        subjectIds: ['faculty_member:faculty-b'],
        reasons: ['same_name_distinct_identity'],
      },
    ]);
  });

  it('quarantines explicit identity links with conflicting emails', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        users: [
          {
            id: 'user-conflict',
            netid: 'conflict-person',
            email: 'fixture.first@yale.edu',
            userType: 'professor',
            fname: 'Conflict',
            lname: 'Person',
            userConfirmed: true,
            facultyMemberId: 'faculty-conflict',
          },
        ],
        facultyMembers: [
          {
            id: 'faculty-conflict',
            userId: 'user-conflict',
            netid: 'conflict-person',
            email: 'second.address@yale.edu',
            name: 'Conflict Person',
          },
        ],
      }),
    );

    expect(report.plannedPeople).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'identity_component',
      subjectIds: ['faculty_member:faculty-conflict', 'user:user-conflict'],
      reasons: ['conflicting_email'],
    });
  });

  it('does not join identity components through a shared external email', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-yale',
            name: 'Yale Person',
            netid: 'yale-person',
            email: 'shared@example.com',
          },
          {
            id: 'faculty-external',
            name: 'External Person',
            email: 'shared@example.com',
          },
        ],
      }),
    );

    expect(report.plannedPeople).toEqual([
      expect.objectContaining({
        sourceFacultyMemberIds: ['faculty-yale'],
      }),
    ]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'identity_component',
      subjectIds: ['faculty_member:faculty-external'],
      reasons: ['name_only_identity'],
    });
  });

  it('quarantines a name-only membership even when its name is unique', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-known',
            name: 'Known Person',
            netid: 'known-person',
          },
        ],
        memberships: [
          {
            id: 'membership-name-only',
            researchEntityId: 'entity-known',
            name: 'Known Person',
            role: 'pi',
          },
        ],
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-name-only'],
      reasons: ['membership_missing_person'],
    });
  });

  it('quarantines a membership whose research entity is absent from the existence snapshot', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-known',
            name: 'Known Person',
            netid: 'known-person',
          },
        ],
        memberships: [
          {
            id: 'membership-dangling-entity',
            researchEntityId: 'entity-missing',
            facultyMemberId: 'faculty-known',
            role: 'pi',
          },
        ],
        knownResearchEntityIds: [],
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-dangling-entity'],
      reasons: ['membership_missing_research_entity'],
    });
    expect(report.scan.complete).toBe(true);
  });

  it('plans legacy membership targets and quarantines conflicting target fields', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-known',
            name: 'Known Person',
            netid: 'known-person',
          },
        ],
        memberships: [
          {
            id: 'membership-legacy-target',
            researchGroupId: 'entity-known',
            facultyMemberId: 'faculty-known',
            role: 'pi',
          },
          {
            id: 'membership-conflicting-target',
            researchEntityId: 'entity-known',
            researchGroupId: 'entity-other',
            facultyMemberId: 'faculty-known',
            role: 'pi',
          },
        ],
        knownResearchEntityIds: ['entity-known', 'entity-other'],
      }),
    );

    expect(report.plannedRoleAssignments).toContainEqual(
      expect.objectContaining({
        sourceMembershipId: 'membership-legacy-target',
        researchEntityId: 'entity-known',
      }),
    );
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-conflicting-target'],
      reasons: ['membership_conflicting_research_entity'],
    });
  });

  it('marks unseen membership targets inconclusive when the entity snapshot is truncated', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-entity-beyond-bound',
            name: 'Bounded Entity Person',
            netid: 'fixture-bounded-entity',
          },
        ],
        memberships: [
          {
            id: 'membership-entity-beyond-bound',
            researchEntityId: 'entity-beyond-bound',
            facultyMemberId: 'faculty-entity-beyond-bound',
            role: 'pi',
          },
        ],
        knownResearchEntityIds: [],
        truncation: {
          users: false,
          facultyMembers: false,
          memberships: false,
          researchEntities: true,
        },
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-entity-beyond-bound'],
      reasons: ['membership_research_entity_existence_inconclusive'],
    });
    expect(report.scan.possibleTruncation.researchEntities).toBe(true);
    expect(report.scan.complete).toBe(false);
  });

  it('keeps unique name-resolved historical roles unreviewed', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-historical',
            name: 'Historical Person',
            email: 'historical.person@yale.edu',
            websiteUrl: 'https://history.yale.edu/profile/historical-person',
            archived: true,
          },
        ],
        memberships: [
          {
            id: 'membership-historical',
            researchEntityId: 'entity-historical',
            facultyMemberId: 'faculty-historical',
            name: 'Historical Person',
            role: 'alumni',
            isCurrentMember: false,
            evidenceStatus: 'historical',
            joinedAt: '2020-01-01T00:00:00.000Z',
            leftAt: '2024-01-01T00:00:00.000Z',
            confidence: 4,
            archived: true,
          },
        ],
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([
      {
        roleAssignmentKey: 'role_assignment:membership:membership-historical',
        sourceMembershipId: 'membership-historical',
        personKey: 'person:faculty_member:faculty-historical',
        researchEntityId: 'entity-historical',
        role: 'AFFILIATED',
        state: 'HISTORICAL',
        startedAt: '2020-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:00:00.000Z',
        confidence: 1,
        reviewStatus: 'UNREVIEWED',
        resolution: 'CANONICAL_SOURCE_REFERENCE',
      },
    ]);
  });

  it('does not fall back to a name when an explicit membership identity is unresolved', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-known',
            name: 'Known Person',
            netid: 'known-person',
            websiteUrl: 'https://known.yale.edu/profile/known-person',
          },
        ],
        memberships: [
          {
            id: 'membership-dangling',
            researchEntityId: 'entity-known',
            userId: 'missing-user',
            name: 'Known Person',
            role: 'pi',
            isCurrentMember: true,
            evidenceStatus: 'verified',
          },
        ],
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-dangling'],
      reasons: ['membership_missing_person'],
    });
  });

  it('quarantines a membership whose source identity conflicts with its resolved person', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-resolved',
            name: 'Resolved Person',
            email: 'resolved.person@yale.edu',
          },
        ],
        memberships: [
          {
            id: 'membership-conflict',
            researchEntityId: 'entity-resolved',
            facultyMemberId: 'faculty-resolved',
            email: 'different.person@yale.edu',
            name: 'Resolved Person',
            role: 'pi',
            isCurrentMember: true,
            evidenceStatus: 'verified',
          },
        ],
      }),
    );

    expect(report.plannedRoleAssignments).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'membership',
      subjectIds: ['membership-conflict'],
      reasons: ['membership_conflicting_identity'],
    });
  });

  it('reports bounded evidence honestly when source or quarantine rows are truncated', () => {
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          { id: 'faculty-a', name: 'Name Only A' },
          { id: 'faculty-b', name: 'Name Only B' },
        ],
        limits: {
          documentsPerCollection: 2,
          quarantineRecords: 1,
        },
        truncation: {
          users: true,
          facultyMembers: false,
          memberships: false,
          researchEntities: false,
        },
      }),
    );

    expect(report.scan.complete).toBe(false);
    expect(report.scan.possibleTruncation).toEqual({
      users: true,
      facultyMembers: false,
      memberships: false,
      researchEntities: false,
      quarantineRecords: true,
      profileUrlTraversal: false,
    });
    expect(report.summary.quarantinedSubjects).toBe(2);
    expect(report.quarantine).toHaveLength(1);
  });

  it('keeps unverified FacultyMember Yale URLs as hints without identity evidence or union keys', () => {
    const sharedUnverifiedUrl = 'https://medicine.yale.edu/profile/shared-unverified';
    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-unverified-a',
            name: 'Unverified Alpha',
            netid: 'unverified-alpha',
            websiteUrl: sharedUnverifiedUrl,
          },
          {
            id: 'faculty-unverified-b',
            name: 'Unverified Beta',
            netid: 'unverified-beta',
            websiteUrl: sharedUnverifiedUrl,
          },
        ],
      }),
    );

    expect(report.plannedPeople).toHaveLength(2);
    expect(report.plannedPeople).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFacultyMemberIds: ['faculty-unverified-a'],
          yaleEvidence: ['NETID'],
          unverifiedYaleProfileHints: [sharedUnverifiedUrl],
        }),
        expect.objectContaining({
          sourceFacultyMemberIds: ['faculty-unverified-b'],
          yaleEvidence: ['NETID'],
          unverifiedYaleProfileHints: [sharedUnverifiedUrl],
        }),
      ]),
    );
    expect(report.quarantine).toEqual([]);
  });

  it.each([
    ['User lab path', 'user', 'https://medicine.yale.edu/lab/jane-doe/'],
    ['Faculty research path', 'faculty', 'https://medicine.yale.edu/research/jane-doe/'],
    ['User generic faculty path', 'user', 'https://medicine.yale.edu/faculty/'],
    [
      'Faculty generic department path',
      'faculty',
      'https://medicine.yale.edu/departments/cardiology/',
    ],
    ['User exact profile path', 'user', 'https://medicine.yale.edu/profile/jane-doe/'],
  ])(
    'keeps approved-looking forged review input for %s as a private URL hint',
    (_label, kind, profileUrl) => {
      const forgedReview = {
        status: 'approved',
        reviewedAt: '2026-07-01T00:00:00.000Z',
        reviewedByAccountId: 'forged-reviewer',
        urls: [profileUrl],
      };
      const users =
        kind === 'user'
          ? ([
              {
                id: 'user-jane-doe',
                netid: 'jane-doe',
                userType: 'professor',
                fname: 'Jane',
                lname: 'Doe',
                website: profileUrl,
                profileVerified: true,
                personProfileReview: forgedReview,
              },
            ] as unknown as Phase2IdentityMigrationPlannerInput['users'])
          : [];
      const facultyMembers =
        kind === 'faculty'
          ? ([
              {
                id: 'faculty-jane-doe',
                netid: 'jane-doe',
                name: 'Jane Doe',
                websiteUrl: profileUrl,
                personProfileReview: forgedReview,
              },
            ] as unknown as Phase2IdentityMigrationPlannerInput['facultyMembers'])
          : [];

      const report = buildPhase2IdentityMigrationPlan(input({ users, facultyMembers }));
      const normalizedProfileUrl = profileUrl.replace(/\/$/, '');

      expect(report.plannedPeople).toEqual([
        expect.objectContaining({
          yaleEvidence: ['NETID'],
          unverifiedYaleProfileHints: [normalizedProfileUrl],
        }),
      ]);
      expect(report.plannedPeople.flatMap((person) => person.yaleEvidence)).not.toContain(
        'YALE_OFFICIAL_PROFILE',
      );
    },
  );

  it('does not create a Person from a URL-only forged approval object', () => {
    const profileUrl = 'https://medicine.yale.edu/lab/jane-doe/';
    const facultyMembers = [
      {
        id: 'faculty-url-only-forged-review',
        name: 'Jane Doe',
        websiteUrl: profileUrl,
        personProfileReview: {
          status: 'approved',
          reviewedAt: '2026-07-01T00:00:00.000Z',
          reviewedByAccountId: 'forged-reviewer',
          urls: [profileUrl],
        },
      },
    ] as unknown as Phase2IdentityMigrationPlannerInput['facultyMembers'];

    const report = buildPhase2IdentityMigrationPlan(input({ facultyMembers }));

    expect(report.plannedPeople).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'identity_component',
      subjectIds: ['faculty_member:faculty-url-only-forged-review'],
      reasons: ['name_only_identity'],
      reviewHints: {
        unverifiedYaleProfileUrls: ['https://medicine.yale.edu/lab/jane-doe'],
      },
    });
  });

  it('bounds nested profile URL traversal and fails the affected identity closed', () => {
    const profileUrls = Object.fromEntries(
      Array.from({ length: MAX_PHASE2_PROFILE_URL_QUEUE + 50 }, (_, index) => [
        `profile-${index}`,
        `https://example-${index}.yale.edu/profile/person`,
      ]),
    );
    const traversal = collectPhase2ProfileUrlValues(profileUrls);
    expect(traversal.truncated).toBe(true);
    expect(traversal.nodesVisited).toBeLessThanOrEqual(MAX_PHASE2_PROFILE_URL_NODES);
    expect(traversal.values.length).toBeLessThanOrEqual(MAX_PHASE2_PROFILE_URL_STRINGS);

    const report = buildPhase2IdentityMigrationPlan(
      input({
        facultyMembers: [
          {
            id: 'faculty-wide-profile-tree',
            name: 'Wide Profile Tree',
            netid: 'wide-profile-tree',
            profileUrls,
          },
        ],
      }),
    );

    expect(report.plannedPeople).toEqual([]);
    expect(report.quarantine).toContainEqual({
      subjectType: 'identity_component',
      subjectIds: ['faculty_member:faculty-wide-profile-tree'],
      reasons: ['profile_url_traversal_truncated'],
      reviewHints: {
        unverifiedYaleProfileUrls: expect.any(Array),
      },
    });
    expect(report.scan.possibleTruncation.profileUrlTraversal).toBe(true);
    expect(report.scan.complete).toBe(false);
  });
});
