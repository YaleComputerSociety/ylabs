import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField } from '../confidenceResolver';
import { publicResearchDetailGroup } from '../../services/researchGroupService';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import {
  isLinkedPublicationOrDocumentUrl,
  withoutUncreditedLinkedPublicationOrDocumentCitations,
} from '../../utils/researchHomeWebsiteUrl';

const OWN_PROFILE = 'https://earth.yale.edu/profile/synthetic-person-fixture';
const SECOND_PROFILE = 'https://medicine.yale.edu/profile/synthetic-person-fixture/';
const DRIVE_PAPER = 'https://drive.google.com/open?id=SyntheticFixtureFileId&usp=drive_copy';
const SHAREPOINT_CV =
  'https://example-my.sharepoint.com/:b:/g/personal/synthetic_fixture/SyntheticFixtureShareId';
const DOI_PAPER = 'https://www.science.org/doi/10.0000/synthetic.fixture.0001';
const DOI_RESOLVER = 'https://doi.org/10.0000/synthetic.fixture.0002';
const PUBMED_RECORD = 'https://pubmed.ncbi.nlm.nih.gov/10000001/';
const PMC_RECORD = 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC0000001/';
const DEPARTMENT_PDF = 'https://history.yale.edu/sites/default/files/synthetic-fixture-essay.pdf';
const PERSONAL_SITE = 'https://synthetic-fixture-research.example.org/';

const resolvedField = (value: unknown): ResolvedField => ({
  value,
  confidence: 0.9,
  contributingSources: ['synthetic-source'],
  hasConflict: false,
});

const noopCanonicalizer = (async () => undefined) as unknown;

const researchEntityInput = (
  overrides: Partial<ProjectFromLogInput> = {},
): ProjectFromLogInput => ({
  resolved: {},
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc: null,
  materializationObs: [],
  resolverObs: [],
  fullDescriptionShellGated: false,
  now: new Date('2020-01-01T00:00:00.000Z'),
  synthesizeCardDescription: async () => '',
  applyDescriptionResearchAreaDerivation:
    noopCanonicalizer as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
  applyResearchEntityOrgUnitCanonicalization:
    noopCanonicalizer as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
  applyResearchEntityResearchAreaCanonicalization:
    noopCanonicalizer as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
  ...overrides,
});

const facultyResearchRow = (overrides: Record<string, unknown> = {}) => ({
  _id: 'e'.repeat(24),
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  slug: 'faculty-research-area-synthetic-person-fixture',
  name: 'Synthetic Person Fixture Faculty Research',
  confidenceByField: {},
  ...overrides,
});

describe('the shape of a linked paper or file', () => {
  it.each([
    DRIVE_PAPER,
    SHAREPOINT_CV,
    DOI_PAPER,
    DOI_RESOLVER,
    PUBMED_RECORD,
    PMC_RECORD,
    DEPARTMENT_PDF,
  ])('reads %s as a paper or file', (url) => {
    expect(isLinkedPublicationOrDocumentUrl(url)).toBe(true);
  });

  it.each([
    OWN_PROFILE,
    PERSONAL_SITE,
    'https://reporter.nih.gov/project-details/10000001',
    'https://www.ncbi.nlm.nih.gov/myncbi/synthetic.fixture.1/bibliography/public/',
    'https://synthetic-fixture-lab.example.org/doing-research/',
    'https://jackson.yale.edu/synthetic-initiative/courses',
  ])('does not read %s as a paper or file', (url) => {
    expect(isLinkedPublicationOrDocumentUrl(url)).toBe(false);
  });

  it('keeps a document a served field was read from', () => {
    expect(
      withoutUncreditedLinkedPublicationOrDocumentCitations([OWN_PROFILE, DEPARTMENT_PDF], {
        fullDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
      }),
    ).toEqual([OWN_PROFILE, DEPARTMENT_PDF]);
  });
  it('does not keep a document only bookkeeping provenance credits', () => {
    expect(
      withoutUncreditedLinkedPublicationOrDocumentCitations([OWN_PROFILE, SHAREPOINT_CV], {
        leadVerification: { sourceName: 'synthetic-source', sourceUrl: SHAREPOINT_CV },
      }),
    ).toEqual([OWN_PROFILE]);
  });
});

describe('a linked paper or file is not cited as a source', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it('drops a stored paper link on a pass that re-derives no citation', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Fixture Faculty Research') },
        entityDoc: facultyResearchRow({
          sourceUrls: [OWN_PROFILE, DRIVE_PAPER, SECOND_PROFILE],
        }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE, SECOND_PROFILE]);
  });

  it('drops a paper link a live observation still asserts', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Faculty Research'),
          sourceUrls: resolvedField([OWN_PROFILE, DOI_PAPER]),
        },
        entityDoc: facultyResearchRow({ sourceUrls: [OWN_PROFILE, DOI_PAPER, PUBMED_RECORD] }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('keeps a document a served field was read from', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Faculty Research'),
          sourceUrls: resolvedField([OWN_PROFILE]),
        },
        entityDoc: facultyResearchRow({
          sourceUrls: [OWN_PROFILE, DEPARTMENT_PDF, SHAREPOINT_CV],
          fieldProvenance: {
            methods: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
          },
        }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([DEPARTMENT_PDF, OWN_PROFILE]);
  });

  it('leaves a locked citation list alone', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Fixture Faculty Research') },
        manuallyLockedFields: ['sourceUrls'],
        entityDoc: facultyResearchRow({ sourceUrls: [OWN_PROFILE, DRIVE_PAPER] }),
      }),
    );
    expect(result.set.sourceUrls).toBeUndefined();
  });

  it('withholds a stored paper link from the served detail payload', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(
        facultyResearchRow({
          studentVisibilityTier: 'student_ready',
          sourceUrls: [OWN_PROFILE, DRIVE_PAPER, DOI_RESOLVER, PERSONAL_SITE],
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE, PERSONAL_SITE]);
  });

  it('serves a document a served field was read from', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(
        facultyResearchRow({
          studentVisibilityTier: 'student_ready',
          sourceUrls: [OWN_PROFILE, DEPARTMENT_PDF],
          fieldProvenance: {
            shortDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
          },
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE, DEPARTMENT_PDF]);
  });
});
