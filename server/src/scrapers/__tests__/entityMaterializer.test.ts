import { describe, expect, it } from 'vitest';
import {
  addPostMaterializationMetrics,
  aggregateResearchEntityGrantEvidence,
  buildInferredPiMemberUpsert,
  centerRelationshipTypeForResolvedTarget,
  relationshipLabelForType,
  rosterEnrichmentWithRetainedSuccessfulSnapshot,
  buildRosterMemberUpsert,
  canonicalRosterProvenanceFromSet,
  deriveResearchEntityWebsiteUrl,
  buildOfficialRosterArchiveFilter,
  emptyPostMaterializationMetrics,
  normalizeMaterializerObjectId,
  officialProfileObservationMatchesUser,
  sanitizeResearchEntitySourceUrlsForMaterialization,
  selectOfficialProfileObservationUserMatch,
  shouldPreserveExistingUserIdentityField,
  shouldIgnoreObservationForEntityMaterialization,
  uniqueKeyValueForIdentifier,
  userLookupFiltersForOfficialProfileObservations,
  userLookupFiltersForInferredPiUserKey,
  userLookupValueForInferredPiUserKey,
} from '../entityMaterializer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';

describe('entityMaterializer post-materialization metrics', () => {
  it('merges cross-source grant evidence by stable grant id', () => {
    expect(
      aggregateResearchEntityGrantEvidence([
        {
          field: 'recentGrants',
          sourceName: 'nih',
          observedAt: new Date('2025-01-01'),
          value: [{ id: 'AGED-OUT' }],
        },
        {
          field: 'recentGrants',
          sourceName: 'nih',
          observedAt: new Date('2026-01-01'),
          value: [{ id: 'NIH-1' }, { id: 'SHARED', title: 'old' }],
        },
        {
          field: 'recentGrants',
          sourceName: 'nsf',
          observedAt: new Date('2026-01-01'),
          value: [{ id: 'NSF-1' }, { id: 'shared', title: 'new' }],
        },
        {
          field: 'recentGrantCount',
          sourceName: 'nih',
          observedAt: new Date('2025-01-01'),
          value: 14,
        },
        {
          field: 'recentGrantCount',
          sourceName: 'nih',
          observedAt: new Date('2026-01-01'),
          value: 12,
        },
        {
          field: 'recentGrantCount',
          sourceName: 'nsf',
          observedAt: new Date('2026-01-01'),
          value: 11,
        },
        {
          field: 'fundingAgencies',
          sourceName: 'nih',
          observedAt: new Date('2026-01-01'),
          value: ['NIH'],
        },
        {
          field: 'fundingAgencies',
          sourceName: 'nsf',
          observedAt: new Date('2026-01-01'),
          value: ['NSF', 'nih'],
        },
      ]),
    ).toEqual({
      recentGrants: [{ id: 'NIH-1' }, { id: 'shared', title: 'new' }, { id: 'NSF-1' }],
      recentGrantCount: 23,
      fundingAgencies: ['NIH', 'NSF'],
    });
  });

  it('bounds the grant display independently of source totals', () => {
    const evidence = aggregateResearchEntityGrantEvidence([
      {
        field: 'recentGrants',
        sourceName: 'nsf',
        observedAt: new Date('2026-01-01'),
        value: Array.from({ length: 12 }, (_, index) => ({ id: `NSF-${index}` })),
      },
      {
        field: 'recentGrantCount',
        sourceName: 'nsf',
        observedAt: new Date('2026-01-01'),
        value: 12,
      },
    ]);
    expect(evidence.recentGrants).toHaveLength(10);
    expect(evidence.recentGrantCount).toBe(12);
  });

  it('normalizes materializer ObjectIds without object-shaped coercion', () => {
    expect(normalizeMaterializerObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeMaterializerObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeMaterializerObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('normalizes prefixed user entity keys to the stored netid value', () => {
    expect(
      uniqueKeyValueForIdentifier('user', 'netid:yang.cai', [
        { field: 'netid', value: 'yang.cai' },
      ]),
    ).toBe('yang.cai');
    expect(uniqueKeyValueForIdentifier('user', 'netid:abc123', [])).toBe('abc123');
    expect(uniqueKeyValueForIdentifier('researchEntity', 'dept-cs-example', [])).toBe(
      'dept-cs-example',
    );
    expect(userLookupValueForInferredPiUserKey('netid:hc685')).toBe('hc685');
    expect(userLookupValueForInferredPiUserKey('dept:physics:hayden-material')).toBe(
      'dept:physics:hayden-material',
    );
    expect(userLookupValueForInferredPiUserKey('')).toBe('');
  });

  it('builds tolerant user lookup filters for inferred PI keys', () => {
    expect(userLookupFiltersForInferredPiUserKey('netid:hc5')).toEqual([{ netid: 'hc5' }]);
    expect(userLookupFiltersForInferredPiUserKey('netid:hayden.material')).toEqual([
      { netid: 'hayden.material' },
      { email: 'hayden.material@yale.edu' },
    ]);
    expect(userLookupFiltersForInferredPiUserKey('')).toEqual([]);
  });

  it('adds a department-scoped name lookup for inferred department PI keys', () => {
    const filters = userLookupFiltersForInferredPiUserKey('dept:econ:timothy-christensen', [
      'Economics',
    ]);

    expect(filters).toEqual([
      { netid: 'dept:econ:timothy-christensen' },
      {
        fname: /^timothy$/i,
        lname: /^christensen$/i,
        departments: 'Economics',
      },
      {
        fname: /^timothy$/i,
        lname: /^christensen$/i,
        primaryDepartment: 'Economics',
      },
    ]);
  });

  it('builds conservative official-profile user fallback filters', () => {
    const observations = [
      { field: 'fname', value: 'A.' },
      { field: 'lname', value: 'Zayaruznaya' },
      { field: 'departments', value: ['Music'] },
      {
        field: 'profileUrls',
        value: { departmental: 'https://yalemusic.yale.edu/people/zayaruznaya' },
      },
    ];

    expect(userLookupFiltersForOfficialProfileObservations(observations)).toEqual([
      { lname: /zayaruznaya/i, departments: /music/i },
      { lname: /zayaruznaya/i, primaryDepartment: /music/i },
      { name: /zayaruznaya/i, departments: /music/i },
      { name: /zayaruznaya/i, primaryDepartment: /music/i },
      { displayName: /zayaruznaya/i, departments: /music/i },
      { displayName: /zayaruznaya/i, primaryDepartment: /music/i },
    ]);

    expect(
      userLookupFiltersForOfficialProfileObservations(
        observations.filter((obs) => obs.field !== 'profileUrls'),
      ),
    ).toEqual([]);
  });

  it('matches official-profile observations to existing users by name and department', () => {
    const observations = [
      { field: 'fname', value: 'A.' },
      { field: 'lname', value: 'Zayaruznaya' },
      { field: 'departments', value: ['Music'] },
      {
        field: 'profileUrls',
        value: { departmental: 'https://yalemusic.yale.edu/people/zayaruznaya' },
      },
    ];

    expect(
      officialProfileObservationMatchesUser(observations, {
        fname: 'AZ',
        lname: '(A. Zayaruznaya)',
        primaryDepartment: 'MUSI - Music',
        departments: ['MUSI - Music'],
      }),
    ).toBe(true);
    expect(
      officialProfileObservationMatchesUser(observations, {
        fname: 'Beth',
        lname: 'Zayaruznaya',
        primaryDepartment: 'MUSI - Music',
        departments: ['MUSI - Music'],
      }),
    ).toBe(false);
    expect(
      officialProfileObservationMatchesUser(observations, {
        fname: 'AZ',
        lname: '(A. Zayaruznaya)',
        primaryDepartment: 'History',
        departments: ['History'],
      }),
    ).toBe(false);
  });

  it('prefers a canonical user over an email-local alias duplicate', () => {
    const observations = [
      { field: 'fname', value: 'A.' },
      { field: 'lname', value: 'Zayaruznaya' },
      { field: 'departments', value: ['Music'] },
      {
        field: 'profileUrls',
        value: { departmental: 'https://yalemusic.yale.edu/people/zayaruznaya' },
      },
    ];
    const canonical = {
      _id: 'canonical',
      netid: 'az248',
      fname: 'AZ',
      lname: '(A. Zayaruznaya)',
      primaryDepartment: 'MUSI - Music',
      departments: ['MUSI - Music'],
    };
    const alias = {
      _id: 'alias',
      netid: 'ari.match',
      fname: 'A.',
      lname: 'Zayaruznaya',
      primaryDepartment: 'Music',
      departments: ['Music'],
    };

    expect(
      selectOfficialProfileObservationUserMatch(observations, [alias, canonical], 'ari.match'),
    ).toBe(canonical);
    expect(
      selectOfficialProfileObservationUserMatch(observations, [alias, canonical], 'az248'),
    ).toBeNull();
  });

  it('preserves existing non-initial user names over roster initials', () => {
    expect(shouldPreserveExistingUserIdentityField('fname', 'A.', { fname: 'AZ' })).toBe(true);
    expect(shouldPreserveExistingUserIdentityField('fname', 'A.', { fname: 'Anna' })).toBe(true);
    expect(shouldPreserveExistingUserIdentityField('fname', 'Anna', { fname: 'AZ' })).toBe(false);
    expect(shouldPreserveExistingUserIdentityField('lname', 'Zayaruznaya', { fname: 'AZ' })).toBe(
      false,
    );
  });

  it('drops content-page URLs from materialized research entity source URLs', () => {
    expect(
      sanitizeResearchEntitySourceUrlsForMaterialization([
        'https://bei-lab.com/',
        'https://ysph.yale.edu/profile/amy-bei/',
        'https://reporter.nih.gov/project-details/11380220',
        'https://ysph.yale.edu/news-article/meeting-malaria-where-it-lives/',
        'https://example.yale.edu/events/lab-open-house',
      ]),
    ).toEqual([
      'https://bei-lab.com/',
      'https://ysph.yale.edu/profile/amy-bei/',
      'https://reporter.nih.gov/project-details/11380220',
    ]);
    expect(
      sanitizeResearchEntitySourceUrlsForMaterialization('https://example.yale.edu/news'),
    ).toBe('https://example.yale.edu/news');
  });

  it('drops self-referential Yale Research URLs from materialized source URLs', () => {
    expect(
      sanitizeResearchEntitySourceUrlsForMaterialization([
        'https://medicine.yale.edu/lab/qin-yan/',
        'https://yalelabs.io/api/research',
        'https://www.yalelabs.io/research/qin-yan-lab',
      ]),
    ).toEqual(['https://medicine.yale.edu/lab/qin-yan/']);
  });

  it('ignores official-profile bio observations that are address or page chrome', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value: 'Kline Tower Room 1247 219 Prospect Street New Haven, CT 06511',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value: 'See my webpage for selected publications.',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value: 'Medical Research InterestsMammography; Radiology',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value: 'Associate Research Scientist in Psychiatry',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          "Jules Fixture studies translational cancer biology and develops clinical research programs. For more on this research, refer to Dr. Kim's complete Google Scholar profile.",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          'Yale Engineering advances AI innovation with seed funding for high-impact research and workshops',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          'Ph.D., English, University of VirginiaM.A., English, McGill UniversityB.A., English, University of California at Los Angeles',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          'Yingzheng Fan, Yu Yan, Obinna Nwokonkwo, John Kim, Margaret Liu, Leo Chen, Lea R. Winter*. "Tuning membranes for selective separations." Nature Materials 2024.',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          "View this doctor's clinical profile on the Yale Medicine website for information about the services we offer and making an appointment.",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'bio',
        sourceName: 'official-profile-pi-backfill',
        value:
          'Drew Fixture studies algorithmic learning theory, formal languages, and computational models for learning from queries.',
      }),
    ).toBe(false);
  });

  it('starts with zeroed access artifact counters', () => {
    expect(emptyPostMaterializationMetrics()).toEqual({
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
      undergraduateLogisticsClaims: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: 0,
      conflicts: 0,
      errors: 0,
    });
  });

  it('aggregates partial access artifact counters defensively', () => {
    const aggregate = emptyPostMaterializationMetrics();

    addPostMaterializationMetrics(aggregate, {
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      guardedContactRoutes: 1,
    });
    addPostMaterializationMetrics(aggregate, {
      postedOpportunities: 4,
      undergraduateLogisticsClaims: 0,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
    addPostMaterializationMetrics(aggregate);

    expect(aggregate).toEqual({
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      postedOpportunities: 4,
      undergraduateLogisticsClaims: 0,
      guardedContactRoutes: 1,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
  });

  it('treats retired access fields as signal-source-only, never persisting them to the entity doc', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: 'lastObservedAt',
        sourceName: 'dept-faculty-roster',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
      }),
    ).toBe(true);
    for (const field of ['acceptingUndergrads', 'openness']) {
      for (const sourceName of ['ysm-atoz-index', 'lab-microsite-undergrad-llm']) {
        expect(
          shouldIgnoreObservationForEntityMaterialization('researchGroup', { field, sourceName }),
        ).toBe(true);
        expect(
          shouldIgnoreObservationForEntityMaterialization('researchEntity', { field, sourceName }),
        ).toBe(true);
      }
    }
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(false);
  });

  it('redacts direct contact details consistently for materialized public excerpts', () => {
    expect(redactDirectContactInfo('Email ada@yale.edu or call 203-432-1234.')).toBe(
      'Email [email redacted] or call [phone redacted].',
    );
  });

  it('builds a PI membership upsert from inferredPiUserId observations', () => {
    const patch = buildInferredPiMemberUpsert('64f000000000000000000010', {
      value: '64f000000000000000000020',
      sourceUrl: 'https://medicine.yale.edu/lab/yachiho/',
      sourceName: 'ysm-atoz-index',
      confidence: 0.84,
      observedAt: new Date('2026-05-25T00:00:00Z'),
    });

    expect(patch).toEqual({
      filter: {
        researchEntityId: '64f000000000000000000010',
        userId: '64f000000000000000000020',
        role: 'pi',
        isCurrentMember: true,
      },
      update: {
        $set: {
          researchEntityId: '64f000000000000000000010',
          researchGroupId: '64f000000000000000000010',
          userId: '64f000000000000000000020',
          role: 'pi',
          isCurrentMember: true,
          sourceUrl: 'https://medicine.yale.edu/lab/yachiho/',
          confidence: 0.84,
          lastObservedAt: new Date('2026-05-25T00:00:00Z'),
          'confidenceByField.role': 0.84,
          'fieldProvenance.role': {
            sourceName: 'ysm-atoz-index',
            sourceUrl: 'https://medicine.yale.edu/lab/yachiho/',
            observedAt: new Date('2026-05-25T00:00:00Z'),
            confidence: 0.84,
          },
        },
        $setOnInsert: {
          startedAt: new Date('2026-05-25T00:00:00Z'),
        },
      },
    });
  });

  it('builds a research entity member upsert from center member observations', () => {
    const observedAt = new Date('2026-06-06T00:00:00Z');
    const patch = buildRosterMemberUpsert(
      '64f000000000000000000010',
      {
        researchGroupKey: {
          value: 'center-cowles',
          confidence: 0.9,
          sourceName: 'centers-institutes-index',
          observedAt,
          hasConflict: false,
          contributingSources: ['centers-institutes-index'],
        },
        role: {
          value: 'director',
          confidence: 0.86,
          sourceName: 'centers-institutes-index',
          sourceUrl: 'https://egc.yale.edu/people/faculty',
          observedAt,
          hasConflict: false,
          contributingSources: ['centers-institutes-index'],
        },
        inferredUserName: {
          value: { fname: 'Jane', lname: 'Doe' },
          confidence: 0.86,
          sourceName: 'centers-institutes-index',
          observedAt,
          hasConflict: false,
          contributingSources: ['centers-institutes-index'],
        },
        title: {
          value: 'Director, Cowles Foundation',
          confidence: 0.86,
          sourceName: 'centers-institutes-index',
          observedAt,
          hasConflict: false,
          contributingSources: ['centers-institutes-index'],
        },
      },
      { _id: '64f000000000000000000020' },
    );

    expect(patch).toMatchObject({
      filter: {
        researchEntityId: '64f000000000000000000010',
        userId: '64f000000000000000000020',
        role: 'director',
        isCurrentMember: true,
      },
      update: {
        $set: {
          researchEntityId: '64f000000000000000000010',
          researchGroupId: '64f000000000000000000010',
          userId: '64f000000000000000000020',
          name: 'Jane Doe',
          role: 'director',
          isCurrentMember: true,
          sourceUrl: 'https://egc.yale.edu/people/faculty',
          confidence: 0.86,
          title: 'Director, Cowles Foundation',
          'confidenceByField.role': 0.86,
          'confidenceByField.title': 0.86,
          'fieldProvenance.role': {
            sourceName: 'centers-institutes-index',
            sourceUrl: 'https://egc.yale.edu/people/faculty',
            observedAt,
            confidence: 0.86,
          },
        },
        $setOnInsert: { startedAt: observedAt },
      },
    });
  });

  it('materializes official roster membership idempotently from stable source identity', () => {
    const observedAt = new Date('2026-07-14T00:00:00Z');
    const field = (value: unknown) => ({
      value,
      confidence: 0.95,
      sourceName: 'official-research-home-roster',
      sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
      observedAt,
      hasConflict: false,
      contributingSources: ['official-research-home-roster'],
    });
    const resolved = {
      role: field('grad-student'),
      name: field('Fixture Scholar'),
      title: field('Graduate Student'),
      profileUrl: field('https://medicine.yale.edu/lab/fixture/profile/fixture-scholar/'),
      identityKey: field('official-profile:fixture-scholar'),
      membershipKey: field('official-profile:fixture-scholar|grad-student'),
      currentStatus: field('current'),
      evidenceStatus: field('verified'),
      freshnessExpiresAt: field('2026-08-04T00:00:00Z'),
    };

    const first = buildRosterMemberUpsert('64f000000000000000000010', resolved);
    const second = buildRosterMemberUpsert('64f000000000000000000010', resolved);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      filter: {
        researchEntityId: '64f000000000000000000010',
        membershipKey: 'official-profile:fixture-scholar|grad-student',
        role: 'grad-student',
        isCurrentMember: true,
      },
      update: {
        $set: {
          sourceName: 'official-research-home-roster',
          profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/fixture-scholar/',
          evidenceStatus: 'verified',
        },
      },
    });
  });

  it('coerces ISO-string roster dates from the member upsert set into Date provenance', () => {
    const observedAt = new Date('2026-07-14T00:00:00Z');
    const field = (value: unknown) => ({
      value,
      confidence: 0.95,
      sourceName: 'official-research-home-roster',
      sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
      observedAt,
      hasConflict: false,
      contributingSources: ['official-research-home-roster'],
    });
    const upsert = buildRosterMemberUpsert('64f000000000000000000010', {
      role: field('grad-student'),
      name: field('Fixture Scholar'),
      profileUrl: field('https://medicine.yale.edu/lab/fixture/profile/fixture-scholar/'),
      identityKey: field('official-profile:fixture-scholar'),
      membershipKey: field('official-profile:fixture-scholar|grad-student'),
      currentStatus: field('current'),
      evidenceStatus: field('verified'),
      freshnessExpiresAt: field('2026-08-04T00:00:00Z'),
    });
    const set = (upsert?.update as { $set?: Record<string, unknown> }).$set ?? {};
    expect(typeof set.freshnessExpiresAt).toBe('string');

    const provenance = canonicalRosterProvenanceFromSet(set, 'verified');
    expect(provenance.freshnessExpiresAt).toBeInstanceOf(Date);
    expect((provenance.freshnessExpiresAt as Date).toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(provenance.observedAt).toBeInstanceOf(Date);
    expect(provenance.membershipKey).toBe('official-profile:fixture-scholar|grad-student');
    expect(provenance.evidenceStatus).toBe('verified');
  });

  it('refuses name-only roster identity and any stable-identity collision', () => {
    const observedAt = new Date('2026-07-14T00:00:00Z');
    const field = (value: unknown, hasConflict = false) => ({
      value,
      confidence: 0.95,
      sourceName: 'official-research-home-roster',
      observedAt,
      hasConflict,
      contributingSources: ['official-research-home-roster'],
    });
    expect(
      buildRosterMemberUpsert('64f000000000000000000010', {
        role: field('staff'),
        name: field('Same Name'),
        currentStatus: field('current'),
        evidenceStatus: field('verified'),
      }),
    ).toBeNull();
    expect(
      buildRosterMemberUpsert('64f000000000000000000010', {
        role: field('staff'),
        name: field('Conflicted Name', true),
        identityKey: field('official-profile:collision', true),
        membershipKey: field('official-profile:collision|staff'),
        currentStatus: field('current'),
        evidenceStatus: field('verified'),
      }),
    ).toBeNull();
  });

  it('archives only missing members after a non-empty complete roster snapshot', () => {
    expect(
      buildOfficialRosterArchiveFilter('64f000000000000000000010', {
        complete: true,
        memberKeys: ['official-profile:current|staff'],
      }),
    ).toEqual({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': '64f000000000000000000010',
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
      'rosterProvenance.sourceName': 'official-research-home-roster',
      'rosterProvenance.membershipKey': { $nin: ['official-profile:current|staff'] },
    });
    expect(
      buildOfficialRosterArchiveFilter('64f000000000000000000010', {
        complete: false,
        memberKeys: [],
      }),
    ).toBeNull();
  });

  it('retains the exact last successful roster snapshot across a failed refresh', () => {
    const partial = {
      state: 'partial',
      memberKeys: ['official-profile:retained|staff'],
      sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
      observedAt: new Date('2026-07-14T00:00:00Z'),
      freshnessExpiresAt: new Date('2026-08-04T00:00:00Z'),
    };
    const materializedPartial = rosterEnrichmentWithRetainedSuccessfulSnapshot(partial);
    const failed = rosterEnrichmentWithRetainedSuccessfulSnapshot(
      {
        state: 'failed',
        memberKeys: [],
        sourceUrl: partial.sourceUrl,
        observedAt: new Date('2026-07-15T00:00:00Z'),
      },
      materializedPartial,
    );

    expect(failed).toMatchObject({ state: 'failed', lastSuccessfulSnapshot: partial });
  });
});

describe('deriveResearchEntityWebsiteUrl', () => {
  it('derives websiteUrl from a promotable website when currently empty', () => {
    expect(
      deriveResearchEntityWebsiteUrl({ website: 'https://lab.yale.edu/' }, { websiteUrl: '' }),
    ).toEqual({ action: 'set', websiteUrl: 'https://lab.yale.edu/' });
  });

  it('falls back to the first promotable sourceUrl when website is absent', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        { sourceUrls: ['https://reporter.nih.gov/x', 'https://center.yale.edu/'] },
        { websiteUrl: '' },
      ),
    ).toEqual({ action: 'set', websiteUrl: 'https://center.yale.edu/' });
  });

  it('never overwrites an already-usable websiteUrl on the existing entity', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        { website: 'https://other.yale.edu/' },
        { websiteUrl: 'https://existing.yale.edu/' },
      ),
    ).toEqual({ action: 'keep' });
  });

  it('never overwrites a websiteUrl freshly materialized in this pass', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        { websiteUrl: 'https://fresh.yale.edu/', website: 'https://other.yale.edu/' },
        null,
      ),
    ).toEqual({ action: 'keep' });
  });

  it('excludes grant and identifier hosts as promotable candidates', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        {
          website: 'https://reporter.nih.gov/project/123',
          sourceUrls: ['https://orcid.org/0000-0000-0000-0000', 'https://nsf.gov/award'],
        },
        { websiteUrl: '' },
      ),
    ).toEqual({ action: 'keep' });
  });

  it('leaves websiteUrl empty when no promotable evidence is present', () => {
    expect(deriveResearchEntityWebsiteUrl({}, { websiteUrl: '' })).toEqual({ action: 'keep' });
  });

  it('clears an A-Z-index listing websiteUrl when no research home is available', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        {},
        {
          websiteUrl: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites',
          sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
        },
      ),
    ).toEqual({ action: 'clear' });
  });

  it('re-picks a real research home over a directory listing websiteUrl', () => {
    expect(
      deriveResearchEntityWebsiteUrl(
        {},
        {
          websiteUrl: 'https://physics.yale.edu/people?page=8',
          sourceUrls: ['https://example-computing-lab.example.org/'],
        },
      ),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-computing-lab.example.org/' });
  });
});

describe('center relationship type + label resolution', () => {
  it('chooses AFFILIATED_LAB when the resolved target is a real research home', () => {
    expect(centerRelationshipTypeForResolvedTarget('amy-arnsten-lab', 'MEMBER_RESEARCH_AREA')).toBe(
      'AFFILIATED_LAB',
    );
  });

  it('keeps the fallback type for a generated faculty-research-area target', () => {
    expect(
      centerRelationshipTypeForResolvedTarget(
        'faculty-research-area-amy-arnsten',
        'MEMBER_RESEARCH_AREA',
      ),
    ).toBe('MEMBER_RESEARCH_AREA');
  });

  it('keeps the fallback type when the slug is empty', () => {
    expect(centerRelationshipTypeForResolvedTarget('', 'MEMBER_RESEARCH_AREA')).toBe(
      'MEMBER_RESEARCH_AREA',
    );
  });

  it('labels each relationship type, with a generic fallback', () => {
    expect(relationshipLabelForType('AFFILIATED_LAB')).toBe('Affiliated lab');
    expect(relationshipLabelForType('MEMBER_RESEARCH_AREA')).toBe('Member');
    expect(relationshipLabelForType('HOSTED_PROGRAM')).toBe('Hosted program');
    expect(relationshipLabelForType('SOMETHING_ELSE')).toBe('Related research home');
  });
});
