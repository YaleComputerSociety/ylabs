import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchScholarlyAttribution } from '../../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../../models/researchScholarlyLink';
import { User } from '../../models/user';
import {
  buildScholarlyLinkFromPaper,
  chooseBestScholarlyDestination,
  listPublicMemberScholarlyLinks,
  listPublicScholarlyLinksForResearchEntity,
  listPublicScholarlyLinksForUser,
  toPublicScholarlyLink,
  withResearchActivityRelationship,
} from '../scholarlyLinkService';

const SYNTHETIC_ORCID = '0009-0000-0000-0009';

function mockLeanQuery(rows: any[]) {
  return {
    sort: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(rows),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scholarlyLinkService', () => {
  beforeEach(() => {
    vi.spyOn(ResearchScholarlyAttribution, 'find').mockReturnValue(mockLeanQuery([]) as any);
  });

  it('prefers DOI links over OpenAlex when a paper was discovered through OpenAlex', () => {
    const destination = chooseBestScholarlyDestination({
      openAlexId: 'https://openalex.org/W123',
      doi: '10.5555/scholarly-destination-001',
      url: 'https://openalex.org/W123',
    });

    expect(destination).toEqual({
      destinationKind: 'DOI',
      displaySource: 'DOI',
      url: 'https://doi.org/10.5555/scholarly-destination-001',
    });
  });

  it('keeps DOI as the primary destination and exposes free full text as a backup', () => {
    const destination = chooseBestScholarlyDestination({
      title: 'Synthetic Choice Calibration Dataset',
      doi: '10.5555/choice-calibration-001',
      openAccessUrl: 'https://europepmc.org/articles/PMC1234567?pdf=render',
      url: 'https://openalex.org/W123',
    });

    expect(destination).toEqual({
      destinationKind: 'DOI',
      displaySource: 'DOI',
      url: 'https://doi.org/10.5555/choice-calibration-001',
    });

    const link = buildScholarlyLinkFromPaper({
      title: 'Synthetic Choice Calibration Dataset',
      doi: '10.5555/choice-calibration-001',
      openAccessUrl: 'https://europepmc.org/articles/PMC1234567?pdf=render',
      year: 2009,
      venue: 'Synthetic Behavior Archive',
      sources: ['openalex'],
    });

    expect(link).toMatchObject({
      title: 'Synthetic Choice Calibration Dataset',
      url: 'https://doi.org/10.5555/choice-calibration-001',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      freeFullTextUrl: 'https://europepmc.org/articles/PMC1234567?pdf=render',
      freeFullTextLabel: 'Free PDF',
    });
  });

  it('does not build research activity links for errata or table-of-contents records', () => {
    const link = buildScholarlyLinkFromPaper({
      title: 'Erratum: Table of contents. Synthetic Methods 12:2',
      doi: '10.5555/erratum-example-001',
      year: 2006,
      venue: 'Synthetic Methods',
    });

    expect(link).toBeNull();
  });

  it('builds compact scholarly links without copying abstracts or citation counts', () => {
    const link = buildScholarlyLinkFromPaper(
      {
        _id: 'paper-1',
        title: 'A synthetic research signal',
        doi: '10.5555/signal-activity-001',
        year: 2024,
        venue: 'Journal of Signals',
        abstract: 'Long abstract should stay out of the profile link shelf.',
        citationCount: 999,
        sources: ['openalex'],
        externalIds: {
          openalex: 'https://openalex.org/W999',
        },
      },
      {
        researchEntityId: '64f000000000000000000010',
        userId: '64f000000000000000000011',
      },
    );

    expect(link).toMatchObject({
      researchEntityId: '64f000000000000000000010',
      userId: '64f000000000000000000011',
      title: 'A synthetic research signal',
      url: 'https://doi.org/10.5555/signal-activity-001',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      year: 2024,
      venue: 'Journal of Signals',
      discoveredVia: 'OPENALEX',
      externalIds: {
        doi: '10.5555/signal-activity-001',
        openAlexId: 'https://openalex.org/W999',
      },
    });
    expect(link).not.toHaveProperty('abstract');
    expect(link).not.toHaveProperty('citationCount');
  });

  it('normalizes MathML markup out of scholarly-link titles', () => {
    const link = buildScholarlyLinkFromPaper({
      title:
        'Charge ordering in<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" display="inline"><mml:mrow><mml:msub><mml:mrow><mml:mi mathvariant="normal">La</mml:mi></mml:mrow><mml:mrow><mml:mn>2</mml:mn></mml:mrow></mml:msub></mml:mrow></mml:math><mml:math display="inline"><mml:mrow><mml:msub><mml:mrow><mml:mi mathvariant="normal">Ni</mml:mi></mml:mrow><mml:mrow><mml:mn>1</mml:mn></mml:mrow></mml:msub></mml:mrow></mml:math><mml:math display="inline"><mml:mrow><mml:msub><mml:mrow><mml:mi mathvariant="normal">O</mml:mi></mml:mrow><mml:mrow><mml:mn>4</mml:mn><mml:mo>+</mml:mo><mml:mi mathvariant="normal">δ</mml:mi></mml:mrow></mml:msub></mml:mrow></mml:math>',
      doi: '10.5555/mathml-title-001',
      year: 1988,
      venue: 'Synthetic Materials Letters',
    });

    expect(link).toMatchObject({
      title: 'Charge ordering in La2 Ni1 O4+δ',
    });
  });

  it('does not build public research activity links when OpenAlex is the only destination', () => {
    const link = buildScholarlyLinkFromPaper({
      title: 'Fallback-only record',
      url: 'https://openalex.org/W123',
      openAlexId: 'https://openalex.org/W123',
      sources: ['openalex'],
      year: 2026,
      venue: 'OpenAlex',
    });

    expect(link).toBeNull();
  });

  it('uses one public research activity object with explicit relationship evidence', () => {
    const baseLink = toPublicScholarlyLink({
      _id: 'link-1',
      title: 'A compact publication link',
      url: 'https://doi.org/10.5555/public-link-001',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      discoveredVia: 'OPENALEX',
      confidence: 0.9,
    });

    expect(
      withResearchActivityRelationship(baseLink, {
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
      }),
    ).toMatchObject({
      title: 'A compact publication link',
      relationshipBasis: 'explicit_entity_link',
      evidenceLabel: 'Linked to this research profile',
    });
    expect(
      withResearchActivityRelationship(baseLink, {
        relationshipBasis: 'member_authorship',
        evidenceLabel: 'Authored by a listed professor',
        userId: 'user-1',
      }),
    ).toMatchObject({
      title: 'A compact publication link',
      relationshipBasis: 'member_authorship',
      evidenceLabel: 'Authored by a listed professor',
      userId: 'user-1',
    });
  });

  it('lists user scholarly links only from compact profile links after legacy cleanup', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: SYNTHETIC_ORCID,
      }),
    } as any);
    const query = mockLeanQuery([
      {
        _id: new mongoose.Types.ObjectId(),
        userId,
        title: 'Synthetic oxide interface benchmark',
        url: 'https://doi.org/10.5555/synthetic-oxide-001',
        destinationKind: 'DOI',
        displaySource: 'DOI',
        discoveredVia: 'OPENALEX',
        year: 2024,
        venue: 'Synthetic Materials Letters',
      },
    ]);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(query as any);

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(query.sort).toHaveBeenCalledWith({
      discoveredVia: 1,
      year: -1,
      observedAt: -1,
      createdAt: -1,
    });
    expect(links).toMatchObject([
      {
        title: 'Synthetic oxide interface benchmark',
        url: 'https://doi.org/10.5555/synthetic-oxide-001',
        displaySource: 'DOI',
        discoveredVia: 'OPENALEX',
        year: 2024,
        venue: 'Synthetic Materials Letters',
      },
    ]);
  });

  it('lists user scholarly links through identity attribution records', async () => {
    const userId = new mongoose.Types.ObjectId();
    const linkId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: SYNTHETIC_ORCID,
      }),
    } as any);
    const attributionQuery = mockLeanQuery([
      {
        scholarlyLinkId: linkId,
        targetUserId: userId,
        relationshipBasis: 'identity_authorship',
        evidenceLabel: 'Authored by a verified Yale faculty identity',
      },
    ]);
    vi.spyOn(ResearchScholarlyAttribution, 'find').mockReturnValue(attributionQuery as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: linkId,
          title: 'Synthetic identity-backed activity',
          url: 'https://doi.org/10.5555/identity-backed-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Identity Journal',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(ResearchScholarlyAttribution.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      targetUserId: userId,
    });
    expect(ResearchScholarlyLink.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      _id: { $in: [linkId] },
    });
    expect(links).toMatchObject([
      {
        _id: String(linkId),
        userId: String(userId),
        title: 'Synthetic identity-backed activity',
        discoveredVia: 'OPENALEX',
      },
    ]);
  });

  it('hides identity-sourced profile links when the user lacks an ORCID identity anchor', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: '',
        openAlexId: 'https://openalex.org/A123',
        googleScholarId: 'fixtureScholar123',
      }),
    } as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'Name collision paper',
          url: 'https://doi.org/10.5555/name-collision-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Mismatch Journal',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'Official profile publication',
          url: 'https://doi.org/10.5555/official-profile-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OFFICIAL_PROFILE',
          year: 2025,
          venue: 'Yale Profile',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      title: 'Official profile publication',
      discoveredVia: 'OFFICIAL_PROFILE',
    });
  });

  it('hides ORCID profile links when the user has no stored ORCID to match', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: '',
      }),
    } as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'Unanchored ORCID paper',
          url: 'https://doi.org/10.5555/unanchored-orcid-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'ORCID',
          year: 2026,
          venue: 'Unverified Journal',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(links).toEqual([]);
  });

  it('filters stored user scholarly links that are not research-paper activity', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: SYNTHETIC_ORCID,
      }),
    } as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Erratum: Table of Contents. Synthetic Methods 12: 2',
          url: 'https://doi.org/10.5555/erratum-example-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2006,
          venue: 'Synthetic Methods',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Synthetic purchasing signal from trial decisions',
          url: 'https://doi.org/10.5555/consumer-signal-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2024,
          venue: 'Synthetic Decision Journal',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      title: 'Synthetic purchasing signal from trial decisions',
    });
  });

  it('hides low-confidence OpenAlex-only rows even when the user has an ORCID anchor', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: SYNTHETIC_ORCID,
      }),
    } as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'Weak OpenAlex-only record',
          url: 'https://openalex.org/W123',
          destinationKind: 'OPENALEX',
          displaySource: 'OpenAlex record',
          discoveredVia: 'OPENALEX',
          confidence: 0.55,
          year: 2026,
          venue: 'OpenAlex',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'DOI-backed activity',
          url: 'https://doi.org/10.5555/doi-backed-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          confidence: 0.8,
          year: 2025,
          venue: 'Trusted Journal',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      title: 'DOI-backed activity',
      destinationKind: 'DOI',
    });
  });

  it('deduplicates user scholarly links by normalized title when source URLs differ', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: userId,
        orcid: SYNTHETIC_ORCID,
      }),
    } as any);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          title:
            'Data from: Model-based integration improves synthetic sensor coverage for narrow-range field samples',
          url: 'https://doi.org/10.5555/archive-dataset-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Synthetic Data Archive',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title:
            'Data from: Model-based integration improves synthetic sensor coverage for narrow-range field samples',
          url: 'https://doi.org/10.5555/archive-dataset-002',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Synthetic Data Archive',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title:
            'Data from: Model-based integration improves synthetic sensor coverage for narrow-range field samples',
          url: 'https://doi.org/10.5555/dryad-example-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2025,
          venue: 'DRYAD',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForUser(userId);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      title:
        'Data from: Model-based integration improves synthetic sensor coverage for narrow-range field samples',
      year: 2026,
      venue: 'Synthetic Data Archive',
    });
  });

  it('deduplicates research-entity scholarly links by normalized title', async () => {
    const researchEntityId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Model-based data integration improves species distribution models',
          url: 'https://doi.org/10.5555/entity-dataset-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Synthetic Data Archive',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Model-based data integration improves species distribution models',
          url: 'https://doi.org/10.5555/entity-dataset-002',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2025,
          venue: 'DRYAD',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForResearchEntity(researchEntityId, [userId]);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      url: 'https://doi.org/10.5555/entity-dataset-001',
      year: 2026,
      venue: 'Synthetic Data Archive',
    });
  });

  it('lists research-entity scholarly links only from compact entity-owned rows', async () => {
    const researchEntityId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          researchEntityId,
          title: 'Synthetic pathways for quantum test materials',
          url: 'https://journals.example.edu/synthetic-quantum-materials',
          destinationKind: 'PUBLISHER',
          displaySource: 'Publisher page',
          discoveredVia: 'MANUAL',
          year: 2023,
          venue: 'Synthetic Materials Review',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForResearchEntity(researchEntityId, [userId]);

    expect(ResearchScholarlyLink.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      researchEntityId,
    });
    expect(links).toMatchObject([
      {
        title: 'Synthetic pathways for quantum test materials',
        url: 'https://journals.example.edu/synthetic-quantum-materials',
        displaySource: 'Publisher page',
        year: 2023,
        venue: 'Synthetic Materials Review',
      },
    ]);
  });

  it('lists research-entity scholarly links through explicit entity attributions', async () => {
    const researchEntityId = new mongoose.Types.ObjectId();
    const linkId = new mongoose.Types.ObjectId();
    vi.spyOn(ResearchScholarlyAttribution, 'find').mockReturnValue(
      mockLeanQuery([
        {
          scholarlyLinkId: linkId,
          targetResearchEntityId: researchEntityId,
          relationshipBasis: 'explicit_entity_link',
          evidenceLabel: 'Linked to this research profile',
        },
      ]) as any,
    );
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: linkId,
          title: 'Synthetic lab-linked result',
          url: 'https://doi.org/10.5555/lab-linked-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'MANUAL',
          year: 2024,
          venue: 'Lab Evidence Journal',
        },
      ]) as any,
    );

    const links = await listPublicScholarlyLinksForResearchEntity(researchEntityId);

    expect(ResearchScholarlyAttribution.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      targetResearchEntityId: researchEntityId,
    });
    expect(ResearchScholarlyLink.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      _id: { $in: [linkId] },
    });
    expect(links).toMatchObject([
      {
        _id: String(linkId),
        researchEntityId: String(researchEntityId),
        title: 'Synthetic lab-linked result',
      },
    ]);
  });

  it('does not list member-owned compact scholarly links as research-entity related research', async () => {
    const researchEntityId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const query = mockLeanQuery([]);
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(query as any);

    const links = await listPublicScholarlyLinksForResearchEntity(researchEntityId, [userId]);

    expect(ResearchScholarlyLink.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      researchEntityId,
    });
    expect(links).toEqual([]);
  });

  it('lists compact current member links but does not expose legacy member publications', async () => {
    const userId = new mongoose.Types.ObjectId();
    vi.spyOn(ResearchScholarlyLink, 'find').mockReturnValue(
      mockLeanQuery([
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          title: 'A compact member-owned link',
          url: 'https://doi.org/10.5555/member-compact-001',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2026,
          venue: 'Member Journal',
        },
      ]) as any,
    );
    vi.spyOn(User, 'find').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: userId,
          orcid: SYNTHETIC_ORCID,
          publications: [
            {
              title: 'Synthetic transition systems for fixture cleanup',
              doi: '10.5555/legacy-member-publication-001',
              year: 2025,
              venue: 'arXiv.org',
            },
          ],
        },
      ]),
    } as any);

    const links = await listPublicMemberScholarlyLinks([userId]);

    expect(ResearchScholarlyLink.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      userId: { $in: [userId] },
    });
    expect(User.find).toHaveBeenCalledWith({ _id: { $in: [userId] } });
    expect(links).toMatchObject([
      {
        title: 'A compact member-owned link',
        url: 'https://doi.org/10.5555/member-compact-001',
        displaySource: 'DOI',
        userId: String(userId),
        year: 2026,
        venue: 'Member Journal',
      },
    ]);
    expect(links).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Synthetic transition systems for fixture cleanup',
        }),
      ]),
    );
  });
});
