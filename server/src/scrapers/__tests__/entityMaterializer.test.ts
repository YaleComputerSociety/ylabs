import { describe, expect, it } from 'vitest';
import {
  addPostMaterializationMetrics,
  buildInferredPiMemberUpsert,
  centerRelationshipTypeForResolvedTarget,
  relationshipLabelForType,
  buildOfficialProfileScholarlyLinkUpserts,
  buildPaperUpdateFromObservations,
  buildResearchGroupMemberUpsert,
  countListingBackedPostedOpportunitiesForRun,
  emptyPostMaterializationMetrics,
  mergeUniqueArrayValues,
  normalizeDoiForMaterialization,
  normalizeMaterializerObjectId,
  officialProfileObservationMatchesUser,
  sanitizeResearchEntitySourceUrlsForMaterialization,
  selectOfficialProfileObservationUserMatch,
  shouldPreserveExistingUserIdentityField,
  shouldClearIgnoredAccessClaimForEntity,
  shouldIgnoreObservationForEntityMaterialization,
  uniqueKeyValueForIdentifier,
  userLookupFiltersForOfficialProfileObservations,
  userLookupFiltersForInferredPiUserKey,
  userLookupValueForInferredPiUserKey,
} from '../entityMaterializer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';

describe('entityMaterializer post-materialization metrics', () => {
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

  it('normalizes DOI values for paper identity matching', () => {
    expect(normalizeDoiForMaterialization(' https://doi.org/10.1000/ABC ')).toBe(
      '10.1000/abc',
    );
    expect(normalizeDoiForMaterialization('')).toBeNull();
    expect(normalizeDoiForMaterialization(undefined)).toBeNull();
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
    const filters = userLookupFiltersForInferredPiUserKey(
      'dept:econ:timothy-christensen',
      ['Economics'],
    );

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
      selectOfficialProfileObservationUserMatch(
        observations,
        [alias, canonical],
        'ari.match',
      ),
    ).toBe(canonical);
    expect(
      selectOfficialProfileObservationUserMatch(observations, [alias, canonical], 'az248'),
    ).toBeNull();
  });

  it('preserves existing non-initial user names over roster initials', () => {
    expect(shouldPreserveExistingUserIdentityField('fname', 'A.', { fname: 'AZ' })).toBe(
      true,
    );
    expect(shouldPreserveExistingUserIdentityField('fname', 'A.', { fname: 'Anna' })).toBe(
      true,
    );
    expect(shouldPreserveExistingUserIdentityField('fname', 'Anna', { fname: 'AZ' })).toBe(
      false,
    );
    expect(shouldPreserveExistingUserIdentityField('lname', 'Zayaruznaya', { fname: 'AZ' })).toBe(
      false,
    );
  });

  it('unions set-like paper fields without duplicating values', () => {
    expect(mergeUniqueArrayValues(['u1', 'u2'], ['u2', 'u3'])).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(mergeUniqueArrayValues(undefined, 'arxiv')).toEqual(['arxiv']);
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
    expect(sanitizeResearchEntitySourceUrlsForMaterialization('https://example.yale.edu/news')).toBe(
      'https://example.yale.edu/news',
    );
  });

  it('builds paper bulk updates that union repeated set-like metadata observations', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'Shared paper',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author One'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author Two'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'sources',
          value: ['openalex'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      openAlexId: 'https://openalex.org/W1',
      title: 'Shared paper',
    });
    expect(patch.update.$addToSet).toMatchObject({
      authors: { $each: ['Author One', 'Author Two'] },
      sources: { $each: ['openalex'] },
    });
  });

  it('does not count materializer-managed paper timestamps as resolved fields', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'Timestamp-safe paper',
          sourceName: 'openalex',
          confidence: 0.9,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'lastObservedAt',
          value: new Date('2026-05-01T00:00:00Z'),
          sourceName: 'openalex',
          confidence: 0.9,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'lastObservedAt',
          value: new Date('2026-05-02T00:00:00Z'),
          sourceName: 'arxiv',
          confidence: 0.89,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.conflicts).toBe(0);
    expect(patch.fieldsWritten).toBe(1);
    expect(patch.update.$set.title).toBe('Timestamp-safe paper');
    expect(patch.update.$set.lastObservedAt).toBeInstanceOf(Date);
    expect(patch.update.$set).not.toHaveProperty('confidenceByField.lastObservedAt');
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

  it('ignores untrusted paper-source author ids when building paper updates', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A name-matched preprint',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorIds',
          value: ['64f000000000000000000001'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorNetIds',
          value: ['aa1'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorIds');
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorNetIds');
  });

  it('derives denormalized paper authors from identity-backed authorship evidence', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'An identity-backed paper',
          sourceName: 'openalex',
          confidence: 0.9,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'paperAuthorshipEvidence',
          value: {
            userId: '64f000000000000000000001',
            netid: 'aa1',
            displayName: 'Amy Arnsten',
            sourceName: 'openalex',
            method: 'openalex-orcid',
            externalAuthorIds: {
              openAlex: 'https://openalex.org/A1',
              orcid: '0000-0001-2345-6789',
            },
          },
          sourceName: 'openalex',
          confidence: 0.95,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet).toMatchObject({
      yaleAuthorIds: { $each: ['64f000000000000000000001'] },
      yaleAuthorNetIds: { $each: ['aa1'] },
    });
    expect(patch.update.$set).not.toHaveProperty('paperAuthorshipEvidence');
  });

  it('keys arXiv paper bulk updates by arxivId rather than openAlexId', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A careful arXiv paper',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      arxivId: '2401.01234',
      title: 'A careful arXiv paper',
    });
    expect(patch.update.$set).not.toHaveProperty('openAlexId');
  });

  it('starts with zeroed access artifact counters', () => {
    expect(emptyPostMaterializationMetrics()).toEqual({
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
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
      guardedContactRoutes: 1,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
  });

  it('counts posted opportunities linked to listing observations in a scrape run', async () => {
    const listingId = '64f000000000000000000099';
    const observationModel = {
      aggregate: async () => [{ _id: listingId }, { _id: undefined }],
    };
    const postedOpportunityModel = {
      countDocuments: async (filter: any) => {
        expect(filter.listingId.$in.map(String)).toEqual([listingId]);
        return 1;
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(1);
  });

  it('returns zero listing-backed posted opportunities when listing ids are missing', async () => {
    const observationModel = {
      aggregate: async () => [{ _id: undefined }, { _id: 'not-an-object-id' }],
    };
    const postedOpportunityModel = {
      countDocuments: async () => {
        throw new Error('should not count without valid listing ids');
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(0);
  });

  it('ignores discovery-only acceptingUndergrads observations for research groups', () => {
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
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'lab-microsite-undergrad-llm',
      }),
    ).toBe(false);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(false);
  });

  it('clears legacy discovery-only acceptance claims unless manually locked or supported', () => {
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'yse-centers-index' },
      ]),
    ).toBe(true);
    expect(
      shouldClearIgnoredAccessClaimForEntity(
        'researchGroup',
        [{ field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' }],
        ['acceptingUndergrads'],
      ),
    ).toBe(false);
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'lab-microsite-undergrad-llm' },
      ]),
    ).toBe(false);
  });

  it('redacts direct contact details consistently for materialized public excerpts', () => {
    expect(redactDirectContactInfo('Email ada@yale.edu or call 203-432-1234.')).toBe(
      'Email [email redacted] or call [phone redacted].',
    );
  });

  it('builds a PI membership upsert from inferredPiUserId observations', () => {
    const patch = buildInferredPiMemberUpsert(
      '64f000000000000000000010',
      {
        value: '64f000000000000000000020',
        sourceUrl: 'https://medicine.yale.edu/lab/yachiho/',
        sourceName: 'ysm-atoz-index',
        confidence: 0.84,
        observedAt: new Date('2026-05-25T00:00:00Z'),
      },
    );

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
    const patch = buildResearchGroupMemberUpsert(
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
      { _id: '64f000000000000000000020', facultyMemberId: '64f000000000000000000030' },
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
          facultyMemberId: '64f000000000000000000030',
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

  it('builds official-profile scholarly link upserts from user observations', () => {
    const observedAt = new Date('2026-05-25T00:00:00Z');
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
        confidence: 0.9,
        observedAt,
        value: [
          {
            title: 'Persons, Roles and Minds',
            year: 2001,
            venue: 'Stanford University Press',
            url: 'https://example.edu/persons-roles-and-minds.pdf',
            sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
          },
        ],
      },
    ]);

    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toMatchObject({
      userId: expect.anything(),
      url: 'https://example.edu/persons-roles-and-minds.pdf',
    });
    expect(String(ops[0].updateOne.filter.userId)).toBe('64f000000000000000000020');
    expect(ops[0].updateOne.update.$set).toMatchObject({
      title: 'Persons, Roles and Minds',
      url: 'https://example.edu/persons-roles-and-minds.pdf',
      destinationKind: 'OTHER',
      displaySource: 'Official Yale profile',
      freeFullTextUrl: '',
      freeFullTextLabel: '',
      discoveredVia: 'OFFICIAL_PROFILE',
      year: 2001,
      venue: 'Stanford University Press',
      confidence: 0.9,
      observedAt,
      sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
      externalIds: {
        officialProfileSourceUrl: 'https://eall.yale.edu/people/taylor-literature',
      },
      archived: false,
    });
  });

  it('deduplicates official-profile scholarly link upserts by destination URL', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://physics.yale.edu/people/example',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'First title',
            url: 'https://www.ncbi.nlm.nih.gov/pubmed/32737322',
            sourceUrl: 'https://physics.yale.edu/people/example',
          },
          {
            title: 'Second title',
            url: 'https://www.ncbi.nlm.nih.gov/pubmed/32737322',
            sourceUrl: 'https://physics.yale.edu/people/example-publications',
          },
        ],
      },
    ]);

    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toMatchObject({
      userId: expect.anything(),
      url: 'https://www.ncbi.nlm.nih.gov/pubmed/32737322',
    });
  });

  it('does not materialize partial publication years from malformed strings', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://physics.yale.edu/people/example',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'Malformed year paper',
            year: '2024abc',
            url: 'https://example.edu/malformed-year-paper',
            sourceUrl: 'https://physics.yale.edu/people/example',
          },
        ],
      },
    ]);

    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set).not.toHaveProperty('year');
  });

  it('does not materialize implausible future publication years', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://physics.yale.edu/people/example',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'Future year paper',
            year: '9999',
            url: 'https://example.edu/future-year-paper',
            sourceUrl: 'https://physics.yale.edu/people/example',
          },
        ],
      },
    ]);

    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set).not.toHaveProperty('year');
  });

  it('does not build official-profile scholarly link upserts for unsafe destination URLs', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://physics.yale.edu/people/example',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'Unsafe destination paper',
            year: 2024,
            url: 'javascript:alert(1)',
            sourceUrl: 'https://physics.yale.edu/people/example',
          },
        ],
      },
    ]);

    expect(ops).toEqual([]);
  });

  it('does not build official-profile scholarly link upserts without HTTP source provenance', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'mailto:professor@example.edu',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'Unsafe provenance paper',
            year: 2024,
            url: 'https://example.edu/paper',
          },
        ],
      },
    ]);

    expect(ops).toEqual([]);
  });

  it('does not build official-profile scholarly link upserts without destination URLs', () => {
    const ops = buildOfficialProfileScholarlyLinkUpserts('64f000000000000000000020', [
      {
        field: 'officialProfilePublications',
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
        confidence: 0.9,
        observedAt: new Date('2026-05-25T00:00:00Z'),
        value: [
          {
            title: 'Persons, Roles and Minds',
            year: 2001,
            venue: 'Stanford University Press',
            sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
          },
        ],
      },
    ]);

    expect(ops).toEqual([]);
  });
});

describe('center relationship type + label resolution', () => {
  it('chooses AFFILIATED_LAB when the resolved target is a real research home', () => {
    expect(
      centerRelationshipTypeForResolvedTarget('amy-arnsten-lab', 'MEMBER_RESEARCH_AREA'),
    ).toBe('AFFILIATED_LAB');
  });

  it('keeps the fallback type for a generated faculty-research-area target', () => {
    expect(
      centerRelationshipTypeForResolvedTarget('faculty-research-area-amy-arnsten', 'MEMBER_RESEARCH_AREA'),
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
