import { describe, expect, it } from 'vitest';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  toPublicResearchEntityDto,
  toPublicResearchEntitySummaryDto,
} from '../researchEntityDto';

describe('researchEntityDto', () => {
  it('strips YSM profile chrome from the served shortDescription without dropping the prose', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-chrome',
      slug: 'ysm-chrome-lab',
      name: 'Chrome Lab',
      kind: 'lab',
      shortDescription: 'INFORMATION FOR Copy Link The lab studies airway disease.',
    });
    expect(dto.shortDescription).toBe('The lab studies airway disease.');
  });

  it('fails a first-person source-bio shortDescription closed in the served DTO (#1077)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-first-person',
      slug: 'ysm-first-person-lab',
      name: 'First Person Lab',
      kind: 'lab',
      shortDescription: 'Bio Website In the laboratory we study lung cancer.',
    });
    expect(dto.shortDescription).toBe('');
  });

  it('drops a first-person card blurb and falls back to fullDescription (#1077)', () => {
    const summary = toPublicResearchEntitySummaryDto({
      _id: { toString: () => 'entity-first-person-blurb' },
      slug: 'ysm-first-person-blurb',
      name: 'First Person Blurb Lab',
      kind: 'lab',
      shortDescription: 'Research in our lab is focused on the DNA damage response.',
      fullDescription: 'This laboratory investigates vascular biology in human disease.',
    });
    expect(summary.blurb).toBe('This laboratory investigates vascular biology in human disease.');
  });

  it('drops a synthesized shortDescription ungrounded in the fullDescription (#1212)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-ungrounded-card',
      slug: 'wyrtzen-jw678',
      name: 'Jonathan Wyrtzen Research',
      kind: 'lab',
      shortDescription: 'Studies Texas from the first.',
      fullDescription:
        'Studies the making of the modern Moroccan state, colonial state formation across North Africa, and the social history of empire in the Maghreb.',
    });
    expect(dto.shortDescription).toBe('');
  });

  it('keeps a synthesized shortDescription grounded in the fullDescription (#1212)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-grounded-card',
      slug: 'grounded-lab',
      name: 'Grounded Lab',
      kind: 'lab',
      shortDescription: 'Studies colonial state formation across North Africa.',
      fullDescription:
        'Studies the making of the modern Moroccan state, colonial state formation across North Africa, and the social history of empire in the Maghreb.',
    });
    expect(dto.shortDescription).toBe('Studies colonial state formation across North Africa.');
  });

  it('drops an ungrounded synthesized card blurb and falls back to fullDescription (#1212)', () => {
    const summary = toPublicResearchEntitySummaryDto({
      _id: { toString: () => 'entity-ungrounded-blurb' },
      slug: 'farina-mf393',
      name: 'Michael Farina Research',
      kind: 'lab',
      shortDescription: 'Studies Italian Cooking.',
      fullDescription:
        'Focuses on Italian language pedagogy, literary translation, and medieval and Renaissance literature.',
    });
    expect(summary.blurb).toBe(
      'Focuses on Italian language pedagogy, literary translation, and medieval and Renaissance literature.',
    );
  });

  it('collapses a doubled research-home suffix at read time so stale storage renders clean (#1106)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-doubled',
      slug: 'faculty-research-area-jane-taylor',
      name: 'Jane Taylor Lab Lab',
      displayName: 'Jane Taylor Lab Lab',
      kind: 'lab',
      entityType: 'LAB',
    });
    expect(dto.name).toBe('Jane Taylor Lab');
    expect(dto.displayName).toBe('Jane Taylor Lab');

    const summary = toPublicResearchEntitySummaryDto({
      _id: { toString: () => 'entity-doubled' },
      slug: 'faculty-research-area-jane-taylor',
      name: 'Jane Taylor Lab Lab',
      kind: 'lab',
    });
    expect(summary.name).toBe('Jane Taylor Lab');
  });

  it('drops a card blurb built from a chrome-only shortDescription and falls back to fullDescription', () => {
    const summary = toPublicResearchEntitySummaryDto({
      _id: { toString: () => 'entity-chrome-only' },
      slug: 'ysm-chrome-only',
      name: 'Chrome Only Lab',
      kind: 'lab',
      shortDescription: 'INFORMATION FOR Copy Link Copy Link',
      fullDescription: 'This laboratory investigates vascular biology in human disease.',
    });
    expect(summary.blurb).toBe('This laboratory investigates vascular biology in human disease.');
  });

  it('builds canonical ResearchEntity DTOs from materialized records', () => {
    const dto = toPublicResearchEntityDto({
      _id: { toString: () => 'entity-1' },
      slug: 'digital-humanities-project',
      name: 'Digital Humanities Project',
      kind: 'initiative',
      description: 'Archives and computational methods.',
      acceptingUndergrads: true,
      openness: 'open',
      acceptanceConfidence: 1,
      departments: ['History'],
      researchAreas: ['Digital humanities'],
      sourceUrls: ['https://example.yale.edu/project'],
    });

    expect(dto).toEqual(
      expect.objectContaining({
        _id: 'digital-humanities-project',
        id: 'digital-humanities-project',
        slug: 'digital-humanities-project',
        name: 'Digital Humanities Project',
        kind: 'initiative',
        entityKind: 'initiative',
        entityType: 'INITIATIVE',
        departments: ['History'],
        researchAreas: ['Digital humanities'],
        sourceUrls: ['https://example.yale.edu/project'],
      }),
    );
    expect(dto).not.toHaveProperty('acceptingUndergrads');
    expect(dto).not.toHaveProperty('openness');
    expect(dto).not.toHaveProperty('acceptanceConfidence');
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

  it('drops prose-sentence researchArea chips from the public DTO (#816)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-chips',
      slug: 'mcnamara-physics',
      name: 'Harry McNamara - Research',
      researchAreas: [
        'Biophysics',
        'Synthetic Biology',
        'We study how cells process information to make collective decisions.',
        'research areas:',
        'Nonlinear Dynamics',
      ],
    });

    expect(dto.researchAreas).toEqual(['Biophysics', 'Synthetic Biology', 'Nonlinear Dynamics']);
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

  it('splits bare comma-delimited research-area blobs while preserving enumeration titles', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-area-split',
      slug: 'nih-pi-example',
      name: 'Example Lab',
      departments: [],
      researchAreas: [
        'Stress Responses And Cortisol',
        'Anxiety, Depression, Psychometrics, Treatment, Cognitive Processes',
        'Water Supply, Quality, and Scarcity',
      ],
      sourceUrls: [],
    });

    expect(dto.researchAreas).toEqual([
      'Stress Responses And Cortisol',
      'Anxiety',
      'Depression',
      'Psychometrics',
      'Treatment',
      'Cognitive Processes',
      'Water Supply, Quality, and Scarcity',
    ]);
  });

  it('redacts direct contact details recursively from public text fields', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-recursive-redaction',
      slug: 'recursive-redaction-lab',
      name: 'Recursive Redaction Lab hidden@example.edu',
      displayName: 'Recursive 203-555-1212 Lab',
      departments: ['TEST - Department hidden@example.edu'],
      researchAreas: ['Calls to 203-555-1212'],
      shortDescription: 'Questions go to hidden@example.edu.',
      planningContext: {
        bestNextStep: 'Email hidden@example.edu after reading the source.',
        reasons: ['Call 203-555-1212 before outreach.'],
      },
      accessSummary: {
        route: {
          label: 'Professor hidden@example.edu',
          rationale: 'Use 203-555-1212 for urgent questions.',
        },
      },
      waysIn: [{ label: 'Email hidden@example.edu to ask about openings.' }],
      searchMatch: { snippet: 'Contact hidden@example.edu or 203-555-1212.' },
    });

    expect(dto.name).toBe('Recursive Redaction Lab [email redacted]');
    expect(dto.displayName).toBe('Recursive [phone redacted] Lab');
    expect(dto.departments).toEqual(['Department [email redacted]']);
    expect(dto.researchAreas).toEqual(['Calls to [phone redacted]']);
    expect(dto.shortDescription).toBe('Questions go to [email redacted].');
    expect(dto.planningContext).toEqual({
      bestNextStep: 'Email [email redacted] after reading the source.',
      reasons: ['Call [phone redacted] before outreach.'],
    });
    expect(dto.accessSummary).toEqual({
      route: {
        label: 'Professor [email redacted]',
        rationale: 'Use [phone redacted] for urgent questions.',
      },
    });
    expect(dto.waysIn).toEqual([{ label: 'Email [email redacted] to ask about openings.' }]);
    expect(dto.searchMatch).toEqual({ snippet: 'Contact [email redacted] or [phone redacted].' });
    expect(JSON.stringify(dto)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(dto)).not.toContain('203-555-1212');
  });

  it('strips glued "YSM Researcher" role-label boilerplate from researchAreas chips (#742)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-ysm-role-label',
      slug: 'ysm-role-label-lab',
      name: 'YSM Role Label Lab',
      researchAreas: [
        'MedicareYSM Researcher',
        'Medicare',
        'YSM Researcher',
        'HistonesYSM Researcher',
      ],
      profileResearchAreas: ['Demyelinating Autoimmune Diseases, CNSYSM Researcher'],
    });

    expect(dto.researchAreas).toEqual(['Medicare', 'Histones']);
    expect(dto.profileResearchAreas).toEqual(['Demyelinating Autoimmune Diseases, CNS']);
    expect(JSON.stringify(dto)).not.toContain('YSM Researcher');
  });

  it('fails a fullDescription closed to empty when it still carries a contact-block or publications dump (#676)', () => {
    const contactBlock = toPublicResearchEntityDto({
      id: 'entity-contact-block',
      slug: 'contact-block-lab',
      name: 'Contact Block Lab',
      fullDescription:
        'Avery Sloane, Ph.D. Professor Email: avery.sloane@example.edu Phone: 203-555-0142 Dr. Avery Sloane studies tissue regeneration after injury.',
    });
    expect(contactBlock.fullDescription).toBe('');

    const publicationsDump = toPublicResearchEntityDto({
      id: 'entity-pub-dump',
      slug: 'pub-dump-lab',
      name: 'Pub Dump Lab',
      fullDescription:
        'The Sloane Lab studies tissue regeneration after injury. Selected Publications:Rivera J, Sloane A. (2023) Signaling dynamics. Cell Reports.',
    });
    expect(publicationsDump.fullDescription).toBe('');

    const clean = toPublicResearchEntityDto({
      id: 'entity-clean-full',
      slug: 'clean-full-lab',
      name: 'Clean Full Lab',
      fullDescription:
        'The Sloane Lab studies how signaling networks coordinate tissue regeneration after injury across model organisms.',
    });
    expect(clean.fullDescription).toBe(
      'The Sloane Lab studies how signaling networks coordinate tissue regeneration after injury across model organisms.',
    );
  });

  it('leaves shortDescription on the token-tolerant path even when fullDescription fails closed (#676)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-short-tolerant',
      slug: 'short-tolerant-lab',
      name: 'Short Tolerant Lab',
      shortDescription: 'Questions go to lab-contact@example.edu.',
      fullDescription: 'Avery Sloane, Ph.D. Professor Email: [email redacted]: 203-555-0142.',
    });

    expect(dto.shortDescription).toBe('Questions go to [email redacted].');
    expect(dto.fullDescription).toBe('');
  });

  it('strips YSM profile chrome from served descriptions and blurbs (#808)', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-ysm-chrome',
      slug: 'ysm-takyar',
      name: 'Takyar Lab',
      shortDescription: 'INFORMATION FOR Copy Link Copy Link',
      fullDescription:
        'INFORMATION FOR The Takyar lab studies liver fibrosis and vascular remodeling in chronic disease.',
    });

    expect(dto.shortDescription).toBe('');
    expect(dto.fullDescription).toBe(
      'The Takyar lab studies liver fibrosis and vascular remodeling in chronic disease.',
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

  it('bounds public DTO normalization before traversing polluted arrays and maps', () => {
    const researchAreas = Array.from({ length: 100 }, (_, index) => `Area ${index}`);
    Object.defineProperty(researchAreas, '100', {
      get: () => {
        throw new Error('research area sanitizer read past the DTO array cap');
      },
      enumerable: true,
    });

    const sourceUrls = Array.from(
      { length: 50 },
      (_, index) => `https://example.yale.edu/source/${index}`,
    );
    Object.defineProperty(sourceUrls, '50', {
      get: () => {
        throw new Error('source URL sanitizer read past the DTO URL cap');
      },
      enumerable: true,
    });

    const reasons = Array.from({ length: 100 }, (_, index) => `Reason ${index}`);
    Object.defineProperty(reasons, '100', {
      get: () => {
        throw new Error('nested DTO sanitizer read past the array cap');
      },
      enumerable: true,
    });

    const qualitySummary: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key${index}`, `value ${index}`]),
    );
    Object.defineProperty(qualitySummary, 'late', {
      get: () => {
        throw new Error('nested DTO sanitizer read past the object key cap');
      },
      enumerable: true,
    });

    const dto = toPublicResearchEntityDto(
      {
        id: 'entity-dto-bounds',
        slug: 'dto-bounds-lab',
        name: 'DTO Bounds Lab',
        shortDescription: 'X'.repeat(6000),
        researchAreas,
        sourceUrls,
        planningContext: { reasons },
        qualitySummary,
      },
      { includeOperatorFields: true },
    );

    expect(dto.shortDescription).toHaveLength(5000);
    expect(dto.researchAreas).toHaveLength(100);
    expect(dto.sourceUrls).toHaveLength(50);
    expect((dto.planningContext as any).reasons).toHaveLength(100);
    expect(Object.keys(dto.qualitySummary as Record<string, unknown>)).toHaveLength(100);
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
      id: 'privacy-lab',
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

  it('disambiguates two student-visible entities sharing an identical name (#1211)', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'ysm-jun-liu',
          slug: 'ysm-jun-liu',
          name: 'The Liu Lab',
          kind: 'lab',
          departments: ['Microbial Pathogenesis'],
          school: 'School of Medicine',
        },
        {
          _id: 'nih-pi-qiao-liu',
          slug: 'nih-pi-qiao-liu',
          name: 'The Liu Lab',
          kind: 'lab',
          departments: ['Biostatistics'],
          school: 'School of Public Health',
        },
      ],
      estimatedTotalHits: 2,
      page: 1,
      pageSize: 24,
    });

    const names = result.researchEntities.map((entity) => entity.name);
    expect(names).toEqual([
      'The Liu Lab (Microbial Pathogenesis)',
      'The Liu Lab (Biostatistics)',
    ]);
  });

  it('disambiguates the served displayName the browse card renders (#1211)', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'ysm-jun-liu',
          slug: 'ysm-jun-liu',
          name: 'The Liu Lab',
          displayName: 'The Liu Lab',
          kind: 'lab',
          departments: ['Microbial Pathogenesis'],
          school: 'School of Medicine',
        },
        {
          _id: 'nih-pi-qiao-liu',
          slug: 'nih-pi-qiao-liu',
          name: 'The Liu Lab',
          displayName: 'The Liu Lab',
          kind: 'lab',
          departments: ['Biostatistics'],
          school: 'School of Public Health',
        },
      ],
      estimatedTotalHits: 2,
      page: 1,
      pageSize: 24,
    });

    expect(result.researchEntities.map((entity) => entity.displayName)).toEqual([
      'The Liu Lab (Microbial Pathogenesis)',
      'The Liu Lab (Biostatistics)',
    ]);
  });

  it('falls back to school when a shared department does not disambiguate a name collision', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'a',
          slug: 'chen-lab-med',
          name: 'The Chen Lab',
          kind: 'lab',
          departments: ['Immunobiology'],
          school: 'School of Medicine',
        },
        {
          _id: 'b',
          slug: 'chen-lab-fas',
          name: 'The Chen Lab',
          kind: 'lab',
          departments: ['Immunobiology'],
          school: 'Faculty of Arts and Sciences',
        },
      ],
      estimatedTotalHits: 2,
      page: 1,
      pageSize: 24,
    });

    expect(result.researchEntities.map((entity) => entity.name)).toEqual([
      'The Chen Lab (School of Medicine)',
      'The Chen Lab (Faculty of Arts and Sciences)',
    ]);
  });

  it('leaves a unique name untouched', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'solo',
          slug: 'solo-lab',
          name: 'The Solo Lab',
          kind: 'lab',
          departments: ['Physics'],
        },
      ],
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 24,
    });

    expect(result.researchEntities[0].name).toBe('The Solo Lab');
  });

  it('trims fullDescription/profileSynthesisDescription from search results and ships a resolved cardDescription instead (#1583)', () => {
    const result = addResearchEntitySearchAliases({
      hits: [
        {
          _id: 'trimmed-lab',
          slug: 'trimmed-lab',
          name: 'Trimmed Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          shortDescription:
            'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
          fullDescription:
            'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
          profileSynthesisDescription: 'A profile-derived summary that should not reach the wire.',
        },
      ],
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 24,
    });

    const entity = result.researchEntities[0];
    expect(entity.fullDescription).toBeUndefined();
    expect(entity.profileSynthesisDescription).toBeUndefined();
    expect(entity.cardDescription).toEqual({
      text: 'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('keeps fullDescription on the detail DTO untrimmed', () => {
    const detail = addResearchEntityDetailAlias({
      group: {
        _id: 'detail-lab',
        slug: 'detail-lab',
        name: 'Detail Lab',
        kind: 'lab',
        shortDescription: 'Studies protein folding.',
        fullDescription: 'This lab studies protein folding across many organisms.',
      },
      members: [],
    });

    expect(detail.researchEntity.fullDescription).toBe(
      'This lab studies protein folding across many organisms.',
    );
    expect(detail.researchEntity.cardDescription).toBeUndefined();
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
    expect(detail.researchEntity.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(detail.members).toEqual([]);
  });

  it('ships sourceLinkHealth to the public DTO with unhealthy links preserved', () => {
    const dto = toPublicResearchEntityDto({
      id: 'entity-source-link-health',
      slug: 'source-link-health-lab',
      name: 'Source Link Health Lab',
      sourceUrls: ['https://example.yale.edu/lab/synthetic-lab'],
      sourceLinkHealth: [
        {
          url: 'https://example.yale.edu/lab/synthetic-lab',
          healthStatus: 'UNAVAILABLE',
          httpStatusCode: 404,
        },
        {
          url: 'https://example.yale.edu/lab/synthetic-lab/publications',
          healthStatus: 'OK',
          httpStatusCode: 200,
        },
        {
          url: 'javascript:alert(document.cookie)',
          healthStatus: 'UNAVAILABLE',
          httpStatusCode: 404,
        },
        { url: 'https://example.yale.edu/lab/missing-status' },
      ],
    });

    expect(dto.sourceLinkHealth).toEqual([
      {
        url: 'https://example.yale.edu/lab/synthetic-lab',
        healthStatus: 'UNAVAILABLE',
        httpStatusCode: 404,
      },
      {
        url: 'https://example.yale.edu/lab/synthetic-lab/publications',
        healthStatus: 'OK',
        httpStatusCode: 200,
      },
    ]);
  });

  it('surfaces sourceLinkHealth on the detail researchEntity payload the client consumes', () => {
    const detail = addResearchEntityDetailAlias({
      group: {
        _id: 'entity-detail-health',
        slug: 'detail-health-lab',
        name: 'Detail Health Lab',
        kind: 'lab',
        websiteUrl: 'https://example.yale.edu/lab/detail-health',
        sourceUrls: ['https://example.yale.edu/lab/detail-health'],
        sourceLinkHealth: [
          {
            url: 'https://example.yale.edu/lab/detail-health',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
          },
        ],
      },
      members: [],
    });

    expect(detail).not.toHaveProperty('group');
    const health = detail.researchEntity.sourceLinkHealth;
    expect(health).toBeDefined();
    const unavailable = (health || []).find(
      (entry) => entry.url === 'https://example.yale.edu/lab/detail-health',
    );
    expect(unavailable).toMatchObject({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 });
  });

  it('exposes only safe public lead identity fields', () => {
    const dto = toPublicResearchEntityDto({
      slug: 'lead-review-lab',
      name: 'Lead Review Lab',
      leadIdentityStatus: 'under_review',
      leadProfessorPublicKey: 'reviewed-professor-pi',
      qualitySummary: { repairFlags: ['pi_identity_conflict'], privateNote: 'operator only' },
    });

    expect(dto).toMatchObject({
      leadIdentityStatus: 'under_review',
      leadProfessorPublicKey: 'reviewed-professor-pi',
    });
    expect(dto).not.toHaveProperty('qualitySummary');
  });

  it('includes methods when present on the served entity', () => {
    const dto = toPublicResearchEntityDto({
      slug: 'methods-lab',
      name: 'Methods Lab',
      kind: 'lab',
      methods: ['CRISPR-Cas9 Gene Editing', 'Single-cell RNA sequencing'],
    });

    expect(dto.methods).toEqual(['CRISPR-Cas9 Gene Editing', 'Single-cell RNA sequencing']);
  });

  it('omits methods when the entity has none', () => {
    const dto = toPublicResearchEntityDto({
      slug: 'no-methods-lab',
      name: 'No Methods Lab',
      kind: 'lab',
    });

    expect(dto).not.toHaveProperty('methods');
  });
});
