import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bestMaterializationProvenanceSourceUrl,
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField } from '../confidenceResolver';
import { publicResearchDetailGroup } from '../../services/researchGroupService';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import {
  isLinkedPublicationOrDocumentUrl,
  isNationalLaboratoryHomePageUrl,
  withoutUncreditedCreditOnlyCitations,
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
const PORTAL_PAPER_PAGE =
  'https://research-portal.example.ac.uk/en/publications/synthetic-degradation-of-fixture-lipids';

const NATIONAL_LAB_HOME = 'https://www.anl.gov/';
const NATIONAL_LAB_LANDING = 'https://www.anl.gov/world/';

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
    PORTAL_PAPER_PAGE,
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
    'https://synthetic-fixture-lab.example.org/publications/',
    'https://synthetic-fixture-lab.example.org/publications/2023',
    'https://synthetic-fixture-lab.example.org/publications/selected',
  ])('does not read %s as a paper or file', (url) => {
    expect(isLinkedPublicationOrDocumentUrl(url)).toBe(false);
  });

  it('keeps a document a served field was read from', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DEPARTMENT_PDF],
        { fullDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF } },
        { fullDescription: 'A synthetic research summary.' },
      ),
    ).toEqual([OWN_PROFILE, DEPARTMENT_PDF]);
  });
  it('does not keep a document credited only for a field that no longer holds a value', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DEPARTMENT_PDF],
        { fullDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF } },
        { fullDescription: '' },
      ),
    ).toEqual([OWN_PROFILE]);
  });
  it('does not keep a document only bookkeeping provenance credits', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, SHAREPOINT_CV],
        { leadVerification: { sourceName: 'synthetic-source', sourceUrl: SHAREPOINT_CV } },
        {},
      ),
    ).toEqual([OWN_PROFILE]);
  });
});

describe('a national laboratory home page', () => {
  it.each([
    NATIONAL_LAB_HOME,
    NATIONAL_LAB_LANDING,
    'https://slac.stanford.edu',
    'http://bnl.gov/index.php',
  ])('reads %s as a national laboratory home page', (url) => {
    expect(isNationalLaboratoryHomePageUrl(url)).toBe(true);
  });

  it.each([
    'https://www.anl.gov/profile/synthetic-person-fixture',
    'https://www.anl.gov/world/synthetic-fixture-facility',
    'https://synthetic-fixture-group.anl.gov/',
    'https://stanford.edu/',
    PERSONAL_SITE,
    OWN_PROFILE,
  ])('does not read %s as a national laboratory home page', (url) => {
    expect(isNationalLaboratoryHomePageUrl(url)).toBe(false);
  });

  it('drops a home page credited only for fields that are now empty', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [NATIONAL_LAB_LANDING, OWN_PROFILE],
        {
          contactInstructionsQuote: {
            sourceName: 'synthetic-source',
            sourceUrl: NATIONAL_LAB_LANDING,
          },
          undergradEvidenceQuote: {
            sourceName: 'synthetic-source',
            sourceUrl: NATIONAL_LAB_LANDING,
          },
        },
        { contactInstructionsQuote: null, undergradEvidenceQuote: '' },
      ),
    ).toEqual([OWN_PROFILE]);
  });

  it('keeps a home page a served summary was read from', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [NATIONAL_LAB_HOME, OWN_PROFILE],
        { fullDescription: { sourceName: 'synthetic-source', sourceUrl: NATIONAL_LAB_HOME } },
        { fullDescription: 'A synthetic research summary.' },
      ),
    ).toEqual([NATIONAL_LAB_HOME, OWN_PROFILE]);
  });
});

describe('a credit on a field that holds no value', () => {
  it('does not keep a document credited by a lead field that is empty', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DOI_PAPER],
        { inferredPiUserId: { sourceName: 'synthetic-source', sourceUrl: DOI_PAPER } },
        { inferredPiUserId: null },
      ),
    ).toEqual([OWN_PROFILE]);
  });

  it('does not keep a document credited by an empty field whose label another field serves', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DEPARTMENT_PDF],
        { shortDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF } },
        { fullDescription: 'A synthetic research summary.', shortDescription: '' },
      ),
    ).toEqual([OWN_PROFILE]);
  });

  it('reads the credited field from the row when the served payload omits it', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DOI_PAPER],
        { displayName: { sourceName: 'synthetic-source', sourceUrl: DOI_PAPER } },
        {},
        { displayName: 'Synthetic Fixture Faculty Research' },
      ),
    ).toEqual([OWN_PROFILE, DOI_PAPER]);
  });

  it('does not keep a document credited by a lead field, which a row never stores', () => {
    expect(
      withoutUncreditedCreditOnlyCitations(
        [OWN_PROFILE, DOI_PAPER],
        { inferredPiUserKey: { sourceName: 'synthetic-source', sourceUrl: DOI_PAPER } },
        { inferredPiUserKey: 'synthetic-person-fixture' },
      ),
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
          methods: ['synthetic fixture assay'],
          fieldProvenance: {
            methods: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
          },
        }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([DEPARTMENT_PDF, OWN_PROFILE]);
  });

  it('does not project back an uncredited document it just dropped', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Fixture Faculty Research') },
        materializationObs: [
          { field: 'leadVerification', sourceUrl: SHAREPOINT_CV, confidence: 0.95 },
        ] as never,
        entityDoc: facultyResearchRow({ sourceUrls: [SHAREPOINT_CV] }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([]);
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
          fullDescription:
            'The synthetic fixture group studies how fixture lipids degrade in cold storage.',
          fieldProvenance: {
            fullDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
          },
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE, DEPARTMENT_PDF]);
  });

  it('withholds a document whose credited field is no longer served', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(
        facultyResearchRow({
          studentVisibilityTier: 'student_ready',
          sourceUrls: [OWN_PROFILE, DEPARTMENT_PDF],
          fieldProvenance: {
            fullDescription: { sourceName: 'synthetic-source', sourceUrl: DEPARTMENT_PDF },
          },
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('drops a stored national laboratory home page credited only by empty fields', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Fixture Faculty Research') },
        entityDoc: facultyResearchRow({
          sourceUrls: [NATIONAL_LAB_LANDING, OWN_PROFILE, PERSONAL_SITE],
          contactInstructionsQuote: null,
          undergradEvidenceQuote: '',
          fieldProvenance: {
            contactInstructionsQuote: {
              sourceName: 'synthetic-source',
              sourceUrl: NATIONAL_LAB_LANDING,
            },
            undergradEvidenceQuote: {
              sourceName: 'synthetic-source',
              sourceUrl: NATIONAL_LAB_LANDING,
            },
          },
        }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE, PERSONAL_SITE]);
  });

  it('withholds a national laboratory home page from the served detail payload', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(
        facultyResearchRow({
          studentVisibilityTier: 'student_ready',
          sourceUrls: [NATIONAL_LAB_LANDING, OWN_PROFILE, PERSONAL_SITE],
          fieldProvenance: {
            undergradEvidenceQuote: {
              sourceName: 'synthetic-source',
              sourceUrl: NATIONAL_LAB_LANDING,
            },
          },
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE, PERSONAL_SITE]);
  });

  it('does not store a document credited only by a lead this pass projects', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Faculty Research'),
          inferredPiUserKey: resolvedField('synthetic-person-fixture'),
        },
        entityDoc: facultyResearchRow({
          sourceUrls: [OWN_PROFILE, DOI_PAPER],
          fieldProvenance: {
            inferredPiUserKey: { sourceName: 'synthetic-source', sourceUrl: DOI_PAPER },
          },
        }),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('withholds a document credited only by an empty lead field from the served payload', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(
        facultyResearchRow({
          studentVisibilityTier: 'student_ready',
          sourceUrls: [OWN_PROFILE, DOI_PAPER],
          inferredPiUserId: null,
          fieldProvenance: {
            inferredPiUserId: { sourceName: 'synthetic-source', sourceUrl: DOI_PAPER },
          },
        }),
      ),
    ) as Record<string, any>;
    expect(served.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('projects a profile rather than a document the lead was verified from', () => {
    const observations = [
      { field: 'leadVerification', sourceUrl: SHAREPOINT_CV, confidence: 0.95 },
      { field: 'inferredPiUserId', sourceUrl: OWN_PROFILE, confidence: 0.8 },
    ];
    expect(bestMaterializationProvenanceSourceUrl(observations as never)).toBe(OWN_PROFILE);
  });

  it('still projects a document when nothing else produced the row', () => {
    const observations = [
      { field: 'leadVerification', sourceUrl: SHAREPOINT_CV, confidence: 0.95 },
    ];
    expect(bestMaterializationProvenanceSourceUrl(observations as never)).toBe(SHAREPOINT_CV);
  });
});
