import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPublicResearchOutreachEvent,
  buildPublicResearchSearchInputs,
  getPublicResearchSortBy,
  redactPublicListing,
  searchListingsWithDegradation,
} from './listingController';
import { AnalyticsEventType } from '../models/analytics';

const baseMongoParams = {
  query: 'cell signaling',
  departmentsMode: 'union',
  academicDisciplinesMode: 'union',
  researchAreasMode: 'union',
  limit: 20,
  offset: 0,
};

void describe('searchListingsWithDegradation', () => {
  void it('retries hybrid Meilisearch failures as keyword-only search', async () => {
    const calls: Array<Record<string, any>> = [];
    const index = {
      search: async (_query: string, params: Record<string, any>) => {
        calls.push(params);
        if (params.hybrid) {
          throw new Error('hybrid unavailable');
        }
        return {
          hits: [{ id: 'listing-1', title: 'Cell signaling lab' }],
          estimatedTotalHits: 1,
        };
      },
    };

    const result = await searchListingsWithDegradation({
      query: 'cell signaling',
      searchParams: {
        limit: 20,
        offset: 0,
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      },
      mongoParams: baseMongoParams,
      getIndex: async () => index,
      mongoSearch: async () => {
        throw new Error('mongo fallback should not be used');
      },
    });

    assert.equal(result.degraded, true);
    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.results, [
      { id: 'listing-1', _id: 'listing-1', title: 'Cell signaling lab' },
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].hybrid, { semanticRatio: 0.8, embedder: 'default' });
    assert.equal(calls[1].hybrid, undefined);
  });

  void it('falls back to Mongo when Meilisearch is unavailable', async () => {
    const result = await searchListingsWithDegradation({
      query: 'immunology',
      searchParams: { limit: 20, offset: 0 },
      mongoParams: { ...baseMongoParams, query: 'immunology' },
      getIndex: async () => ({
        search: async () => {
          throw new Error('meili down');
        },
      }),
      mongoSearch: async () => ({
        hits: [{ _id: 'mongo-listing-1', title: 'Immunology lab' }],
        totalCount: 1,
      }),
    });

    assert.deepEqual(result, {
      results: [{ _id: 'mongo-listing-1', title: 'Immunology lab' }],
      totalCount: 1,
      degraded: true,
    });
  });
});

void describe('public research search inputs', () => {
  void it('removes private fields from public search and sort inputs', async () => {
    const result = await buildPublicResearchSearchInputs({
      query: 'private@example.edu',
      sortBy: 'ownerEmail',
      sortOrder: '1',
      page: '2',
      pageSize: '10',
    });

    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 10);
    assert.equal(result.searchParams.sort, undefined);
    assert.equal(result.mongoParams.sortBy, undefined);
    assert.deepEqual(result.searchParams.attributesToSearchOn, result.mongoParams.searchableFields);
    assert.equal(result.searchParams.attributesToSearchOn.includes('ownerEmail'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('emails'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('ownerId'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('professorIds'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('views'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('favorites'), false);
  });

  void it('allows only public-safe sort fields', () => {
    assert.equal(getPublicResearchSortBy('createdAt'), 'createdAt');
    assert.equal(getPublicResearchSortBy('updatedAt'), 'updatedAt');
    assert.equal(getPublicResearchSortBy('title'), undefined);
    assert.equal(getPublicResearchSortBy('ownerFirstName'), undefined);
    assert.equal(getPublicResearchSortBy('ownerLastName'), undefined);
    assert.equal(getPublicResearchSortBy('ownerEmail'), undefined);
    assert.equal(getPublicResearchSortBy('views'), undefined);
  });

  void it('keeps public filter fields and modes in the search inputs', async () => {
    const result = await buildPublicResearchSearchInputs({
      query: 'genomics',
      departments: 'Computer Science||Biology',
      researchAreas: 'Genomics,Artificial Intelligence',
      departmentsMode: 'intersection',
      academicDisciplinesMode: 'union',
      researchAreasMode: 'intersection',
      sortBy: 'updatedAt',
      sortOrder: '-1',
      page: '3',
      pageSize: '20',
    });

    assert.equal(result.page, 3);
    assert.equal(result.pageSize, 20);
    assert.deepEqual(result.searchParams.sort, ['updatedAt:desc']);
    assert.equal(result.mongoParams.departments, 'Computer Science||Biology');
    assert.equal(result.mongoParams.researchAreas, 'Genomics,Artificial Intelligence');
    assert.equal(result.mongoParams.departmentsMode, 'intersection');
    assert.equal(result.mongoParams.researchAreasMode, 'intersection');
  });
});

void describe('public research outreach analytics inputs', () => {
  void it('builds a privacy-safe contact attempt event', () => {
    const event = buildPublicResearchOutreachEvent({
      action: 'email_click',
      source: 'listing_detail_modal',
      contactCount: 2,
    });

    assert.deepEqual(event, {
      eventType: AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
      metadata: {
        action: 'email_click',
        channel: 'email',
        source: 'listing_detail_modal',
        contactCount: 2,
      },
    });
    assert.equal(JSON.stringify(event).includes('@'), false);
  });

  void it('accepts only supported outreach outcomes', () => {
    assert.deepEqual(
      buildPublicResearchOutreachEvent({
        action: 'outcome',
        outcome: 'emailed',
        source: 'listing_detail_modal',
      }),
      {
        eventType: AnalyticsEventType.OUTREACH_OUTCOME,
        metadata: {
          action: 'outcome',
          channel: 'email',
          source: 'listing_detail_modal',
          contactCount: 0,
          outcome: 'emailed',
        },
      },
    );

    assert.equal(
      buildPublicResearchOutreachEvent({
        action: 'outcome',
        outcome: 'emailed ada@yale.edu',
      }),
      null,
    );
    assert.equal(buildPublicResearchOutreachEvent({ action: 'download_contacts' }), null);
  });
});

void describe('public listing redaction', () => {
  void it('returns sanitized public evidence without private listing fields or raw source URLs', () => {
    const redacted = redactPublicListing({
      _id: { toString: () => '507f1f77bcf86cd799439011' },
      title: 'Evidence-backed lab',
      ownerEmail: 'private@yale.edu',
      emails: ['private-list@yale.edu'],
      ownerId: 'private-netid',
      professorIds: ['private-prof'],
      views: 42,
      favorites: 9,
      archived: false,
      confirmed: true,
      audited: true,
      evidence: {
        status: 'available',
        summary: 'Matched from faculty profile and publication records.',
        confidence: 0.83,
        generatedAt: '2026-01-02T00:00:00.000Z',
        lastVerifiedAt: '2026-02-03T00:00:00.000Z',
        internalNotes: 'Do not expose this analyst note.',
        apiKey: 'secret',
        sources: [
          {
            label: 'OpenAlex work',
            url: 'https://user:pass@example.edu/path?token=secret#private',
            sourceType: 'publication',
            description: 'Public publication metadata',
            lastCheckedAt: '2026-02-01T00:00:00.000Z',
          },
          {
            label: 'Unsafe script',
            url: 'javascript:alert(1)',
          },
        ],
      },
    });

    assert.equal(redacted.ownerEmail, undefined);
    assert.deepEqual(redacted.emails, []);
    assert.equal(redacted.ownerId, undefined);
    assert.deepEqual(redacted.professorIds, []);
    assert.equal(redacted.views, 0);
    assert.equal(redacted.favorites, 0);
    assert.equal(redacted.archived, false);
    assert.equal(redacted.confirmed, true);
    assert.equal(redacted.audited, undefined);
    assert.equal(redacted.evidence.internalNotes, undefined);
    assert.equal(redacted.evidence.apiKey, undefined);
    assert.equal(redacted.evidence.status, 'available');
    assert.equal(
      redacted.evidence.summary,
      'Matched from faculty profile and publication records.',
    );
    assert.equal(redacted.evidence.confidence, 0.83);
    assert.equal(redacted.evidence.sources[0].url, 'https://example.edu/path');
    assert.equal(redacted.evidence.sources[0].label, 'OpenAlex work');
    assert.equal(redacted.evidence.sources[1].url, undefined);
    assert.equal(redacted.evidence.sources[1].label, 'Unsafe script');
  });

  void it('normalizes missing evidence to an empty public rail payload', () => {
    const redacted = redactPublicListing({
      _id: '507f1f77bcf86cd799439011',
      title: 'Lab without evidence',
    });

    assert.deepEqual(redacted.evidence, {
      status: 'unavailable',
      sources: [],
    });
  });
});
