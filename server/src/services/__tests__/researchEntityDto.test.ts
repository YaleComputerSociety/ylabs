import { describe, expect, it } from 'vitest';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  toPublicResearchEntityDto,
} from '../researchEntityDto';

describe('researchEntityDto', () => {
  it('builds canonical ResearchEntity DTOs from materialized records', () => {
    const dto = toPublicResearchEntityDto({
      _id: { toString: () => 'entity-1' },
      slug: 'digital-humanities-project',
      name: 'Digital Humanities Project',
      kind: 'initiative',
      description: 'Archives and computational methods.',
      acceptingUndergrads: true,
      departments: ['History'],
      researchAreas: ['Digital humanities'],
      sourceUrls: ['https://example.yale.edu/project'],
    });

    expect(dto).toEqual(
      expect.objectContaining({
        _id: 'entity-1',
        id: 'entity-1',
        slug: 'digital-humanities-project',
        name: 'Digital Humanities Project',
        kind: 'initiative',
        entityKind: 'initiative',
        entityType: 'INITIATIVE',
        acceptingUndergrads: true,
        departments: ['History'],
        researchAreas: ['Digital humanities'],
        sourceUrls: ['https://example.yale.edu/project'],
      }),
    );
  });

  it('keeps explicit entityType values from materialized records', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-2',
      slug: 'faculty-project',
      name: 'Faculty Project',
      kind: 'individual',
      entityType: 'FACULTY_PROJECT',
    });

    expect(dto.entityType).toBe('FACULTY_PROJECT');
    expect(dto.entityKind).toBe('individual');
  });

  it('collapses prefixed and plain department labels in public DTOs', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-mcdb',
      slug: 'o-donnell-lab',
      name: "O'Donnell Lab",
      departments: [
        'Molecular, Cellular & Developmental Biology',
        'MCDB - Molecular, Cellular & Developmental Biology',
      ],
    });

    expect(dto.departments).toEqual(['Molecular, Cellular & Developmental Biology']);
  });

  it('filters public research entity URL fields to HTTP(S)-only values', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-url-safety',
      slug: 'url-safety-lab',
      name: 'URL Safety Lab',
      website: 'javascript:alert(document.cookie)',
      websiteUrl: 'https://url-safety.example.edu',
      sourceUrls: [
        'https://url-safety.example.edu/source',
        'mailto:hidden@example.edu',
        'javascript:alert(document.cookie)',
        'not-a-url',
      ],
    });

    expect(dto).not.toHaveProperty('website');
    expect(dto.websiteUrl).toBe('https://url-safety.example.edu');
    expect(dto.sourceUrls).toEqual(['https://url-safety.example.edu/source']);
  });

  it('redacts direct contact details from public evidence-style fields', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-evidence-redaction',
      slug: 'evidence-redaction-lab',
      name: 'Evidence Redaction Lab',
      undergradEvidenceQuote:
        'Interested students can email private-contact@yale.edu or call 203-432-1234.',
    });

    expect(dto.undergradEvidenceQuote).toBe(
      'Interested students can email [email redacted] or call [phone redacted].',
    );
  });

  it('omits unsafe public research entity contact email values', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-contact-email-safety',
      slug: 'contact-email-safety-lab',
      name: 'Contact Email Safety Lab',
      contactEmail: 'lab-contact@yale.edu?bcc=attacker@example.test',
    });

    expect(dto.contactEmail).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain('lab-contact@yale.edu?bcc=attacker@example.test');
  });

  it('strips internal review, ownership, and provenance fields from public DTOs', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-private-fields',
      slug: 'privacy-lab',
      name: 'Privacy Lab',
      kind: 'lab',
      claimedByUserId: 'user-private',
      claimedByFaculty: true,
      claimedAt: new Date('2026-01-01T00:00:00.000Z'),
      fieldProvenance: { description: { sourceName: 'private-audit' } },
      embedding: [0.1, 0.2],
      confidenceByField: { description: 0.62 },
      manuallyLockedFields: ['description'],
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: 'private operator note',
      studentVisibilityReviewedByUserId: 'reviewer-private',
      studentVisibilityReviewedAt: new Date('2026-01-02T00:00:00.000Z'),
      lastFacultyNotificationAt: new Date('2026-01-03T00:00:00.000Z'),
      lastInquiryAtCache: new Date('2026-01-04T00:00:00.000Z'),
      totalInquiriesCache: 3,
    });

    expect(dto).toMatchObject({
      id: 'entity-private-fields',
      slug: 'privacy-lab',
      name: 'Privacy Lab',
    });
    expect(dto).not.toHaveProperty('claimedByUserId');
    expect(dto).not.toHaveProperty('claimedByFaculty');
    expect(dto).not.toHaveProperty('claimedAt');
    expect(dto).not.toHaveProperty('fieldProvenance');
    expect(dto).not.toHaveProperty('embedding');
    expect(dto).not.toHaveProperty('confidenceByField');
    expect(dto).not.toHaveProperty('manuallyLockedFields');
    expect(dto).not.toHaveProperty('studentVisibilityOverrideTier');
    expect(dto).not.toHaveProperty('studentVisibilitySuppressionReason');
    expect(dto).not.toHaveProperty('studentVisibilityReviewedByUserId');
    expect(dto).not.toHaveProperty('studentVisibilityReviewedAt');
    expect(dto).not.toHaveProperty('lastFacultyNotificationAt');
    expect(dto).not.toHaveProperty('lastInquiryAtCache');
    expect(dto).not.toHaveProperty('totalInquiriesCache');
  });

  it('returns canonical search entities without legacy hits', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'entity-3',
          slug: 'center-one',
          name: 'Center One',
          kind: 'center',
        },
      ],
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 24,
    });

    expect(result).not.toHaveProperty('hits');
    expect(result.researchEntities[0].entityType).toBe('CENTER');
    expect(result.estimatedTotalHits).toBe(1);
  });

  it('returns canonical detail entity without legacy group', () => {
    const detail = addResearchEntityDetailAlias({
      group: {
        _id: 'entity-4',
        slug: 'smith-research',
        name: 'Smith Research',
        kind: 'individual',
      },
      members: [],
    });

    expect(detail).not.toHaveProperty('group');
    expect(detail.researchEntity.entityType).toBe('INDIVIDUAL_RESEARCH');
    expect(detail.members).toEqual([]);
  });
});
