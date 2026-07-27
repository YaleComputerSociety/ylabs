import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Account, accountSchema } from '../account';
import { OrgUnit } from '../orgUnit';
import { Person, personProfileLinkSchema } from '../person';
import { ResearchEntityRelationship } from '../researchEntityRelationship';
import { RoleAssignment } from '../roleAssignment';
import { TaxonomyTerm } from '../taxonomyTerm';
import * as modelExports from '../index';

const objectId = () => new mongoose.Types.ObjectId();

function validAccount(overrides: Record<string, unknown> = {}) {
  return new Account({
    netid: 'fixture1',
    email: 'fixture1@yale.edu',
    ...overrides,
  });
}

function validPerson(overrides: Record<string, unknown> = {}) {
  return new Person({
    displayName: 'Fixture Person',
    ...overrides,
  });
}

function validRoleAssignment(overrides: Record<string, unknown> = {}) {
  return new RoleAssignment({
    personId: objectId(),
    target: {
      kind: 'RESEARCH_ENTITY',
      id: objectId(),
    },
    role: 'PI',
    confidence: 0.9,
    ...overrides,
  });
}

function validOrgUnit(overrides: Record<string, unknown> = {}) {
  return new OrgUnit({
    slug: 'computer-science',
    name: 'Computer Science',
    kind: 'DEPARTMENT',
    ...overrides,
  });
}

function validTaxonomyTerm(overrides: Record<string, unknown> = {}) {
  return new TaxonomyTerm({
    kind: 'METHOD',
    label: 'Machine Learning',
    normalizedLabel: 'machine learning',
    ...overrides,
  });
}

const verifiedAt = new Date('2026-07-01T00:00:00.000Z');

const validProfileLinks = [
  {
    kind: 'YALE_OFFICIAL',
    purpose: 'PRIMARY_IDENTITY',
    url: 'https://medicine.yale.edu/profile/fixture-person',
    verifiedAt,
    healthStatus: 'HEALTHY',
  },
  {
    kind: 'LAB_ABOUT',
    purpose: 'PRIMARY_IDENTITY',
    url: 'https://example.edu/lab/people/fixture-person',
    verifiedAt,
    healthStatus: 'HEALTHY',
  },
  {
    kind: 'PERSONAL_ACADEMIC',
    purpose: 'PRIMARY_IDENTITY',
    url: 'https://fixture.example.org',
    verifiedAt,
    healthStatus: 'UNKNOWN',
  },
  {
    kind: 'GOOGLE_SCHOLAR',
    purpose: 'SCHOLARLY',
    url: 'https://scholar.google.com/citations?user=abcdefghijkl',
    verifiedAt,
    healthStatus: 'HEALTHY',
  },
  {
    kind: 'ORCID',
    purpose: 'SCHOLARLY',
    url: 'https://orcid.org/9999-9999-9999-9994',
    verifiedAt,
    healthStatus: 'HEALTHY',
  },
];

describe('canonical identity and reference models', () => {
  it('registers explicit canonical model and collection names', () => {
    expect([
      [Account.modelName, Account.collection.name],
      [Person.modelName, Person.collection.name],
      [RoleAssignment.modelName, RoleAssignment.collection.name],
      [OrgUnit.modelName, OrgUnit.collection.name],
      [TaxonomyTerm.modelName, TaxonomyTerm.collection.name],
    ]).toEqual([
      ['Account', 'accounts'],
      ['Person', 'people'],
      ['RoleAssignment', 'role_assignments'],
      ['OrgUnit', 'org_units'],
      ['TaxonomyTerm', 'taxonomy_terms'],
    ]);
  });

  it('defaults every new canonical document to its collection schema version', () => {
    const documents = [
      validAccount(),
      validPerson(),
      validRoleAssignment(),
      validOrgUnit(),
      validTaxonomyTerm(),
    ];

    for (const document of documents) {
      expect(document.schemaVersion).toBe(1);
      expect(document.validateSync()).toBeUndefined();
    }
  });

  it('keeps the account-person relationship only on Person.accountId', () => {
    expect(accountSchema.path('personId')).toBeUndefined();
    expect(accountSchema.path('roles')).toBeUndefined();
    expect(Person.schema.path('accountId')?.options.ref).toBe('Account');

    const accountIndex = Person.schema
      .indexes()
      .find(([fields]) => fields.accountId === 1 && Object.keys(fields).length === 1);
    expect(accountIndex?.[1]).toMatchObject({ unique: true, sparse: true });
    expect(
      Person.schema
        .indexes()
        .some(([fields, options]) => fields.displayName === 1 && options.unique),
    ).toBe(false);
  });

  it('keeps Person role-neutral and free of professor-profile mirrors and copied contact data', () => {
    const forbiddenFields = [
      'role',
      'personType',
      'netid',
      'roles',
      'userType',
      'lastLoginAt',
      'bio',
      'email',
      'phone',
      'website',
      'imageUrl',
      'departments',
      'college',
      'major',
      'title',
      'unit',
      'physicalLocation',
      'mailingAddress',
      'publications',
      'hIndex',
      'citationCount',
      'researchInterests',
      'topics',
      'googleScholarId',
      'openAlexId',
      'semanticScholarId',
    ];

    for (const field of forbiddenFields) {
      expect(Person.schema.path(field)).toBeUndefined();
    }
  });

  it('keeps the reviewed profile-link contract bounded to public outbound-link fields', () => {
    expect(Object.keys(personProfileLinkSchema.paths).sort()).toEqual([
      'healthStatus',
      'kind',
      'purpose',
      'url',
      'verifiedAt',
    ]);
  });

  it('accepts one verified profile link of every supported kind', () => {
    const person = validPerson({
      identifiers: { orcid: '9999-9999-9999-9994' },
      profileLinks: validProfileLinks,
    });

    expect(person.validateSync()).toBeUndefined();
  });

  it('rejects duplicate profile-link kinds', () => {
    const person = validPerson({
      profileLinks: [validProfileLinks[0], { ...validProfileLinks[0] }],
    });

    expect(person.validateSync()?.errors.profileLinks).toBeTruthy();
  });

  it('rejects more than five profile links', () => {
    const person = validPerson({
      profileLinks: [...validProfileLinks, { ...validProfileLinks[0] }],
    });

    expect(person.validateSync()?.errors.profileLinks).toBeTruthy();
  });

  it('rejects profile-link kinds paired with the wrong purpose', () => {
    const person = validPerson({
      profileLinks: [
        {
          ...validProfileLinks[3],
          purpose: 'PRIMARY_IDENTITY',
        },
      ],
    });

    expect(person.validateSync()?.errors['profileLinks.0.purpose']).toBeTruthy();
  });

  it.each([
    ['YALE_OFFICIAL', 'PRIMARY_IDENTITY', 'https://example.org/profile/person'],
    ['GOOGLE_SCHOLAR', 'SCHOLARLY', 'https://example.org/citations?user=abcdefghijkl'],
    ['GOOGLE_SCHOLAR', 'SCHOLARLY', 'http://scholar.google.com/citations?user=abcdefghijkl'],
    ['ORCID', 'SCHOLARLY', 'https://orcid.org/9999-9999-9999-9995'],
  ])('rejects an invalid verified %s URL', (kind, purpose, url) => {
    const person = validPerson({
      profileLinks: [{ kind, purpose, url, verifiedAt }],
    });

    expect(person.validateSync()?.errors['profileLinks.0.url']).toBeTruthy();
  });

  it('requires a verification timestamp for every profile link', () => {
    const person = validPerson({
      profileLinks: [
        {
          ...validProfileLinks[0],
          verifiedAt: undefined,
        },
      ],
    });

    expect(person.validateSync()?.errors['profileLinks.0.verifiedAt']).toBeTruthy();
  });

  it('rejects a profile link with a future verification timestamp', () => {
    const person = validPerson({
      profileLinks: [
        {
          ...validProfileLinks[0],
          verifiedAt: new Date('2999-01-01T00:00:00.000Z'),
        },
      ],
    });

    expect(person.validateSync()?.errors['profileLinks.0.verifiedAt']).toBeTruthy();
  });

  it('requires an ORCID profile URL to match the canonical identifier', () => {
    const person = validPerson({
      identifiers: { orcid: '1234-5678-9012-3451' },
      profileLinks: [validProfileLinks[4]],
    });

    expect(person.validateSync()?.errors.profileLinks).toBeTruthy();
  });

  it('allows a valid ORCID identifier to remain private until a profile link is reviewed', () => {
    const person = validPerson({
      identifiers: { orcid: '9999-9999-9999-9994' },
    });

    expect(person.validateSync()).toBeUndefined();
  });

  it('rejects unbounded identity text and invalid ORCID identifiers', () => {
    expect(
      validPerson({ displayName: 'x'.repeat(241) }).validateSync()?.errors.displayName,
    ).toBeTruthy();
    expect(
      validPerson({ identifiers: { orcid: '9999-9999-9999-9995' } }).validateSync()?.errors[
        'identifiers.orcid'
      ],
    ).toBeTruthy();
  });

  it('normalizes account identity without creating competing authorization roles', () => {
    const account = validAccount({
      netid: ' FIXTURE2 ',
      email: ' FIXTURE2@YALE.EDU ',
    });

    expect(account.netid).toBe('fixture2');
    expect(account.email).toBe('fixture2@yale.edu');
    expect(account.validateSync()).toBeUndefined();
    expect(validAccount({ status: 'ADMIN' }).validateSync()?.errors.status).toBeTruthy();
  });

  it('validates role assignment confidence, lifecycle dates, and bounded evidence references', () => {
    const startedAt = new Date('2026-07-02T00:00:00.000Z');
    const endedAt = new Date('2026-07-01T00:00:00.000Z');
    const duplicateEvidenceId = objectId();

    expect(validRoleAssignment({ confidence: 1.1 }).validateSync()?.errors.confidence).toBeTruthy();
    expect(validRoleAssignment({ startedAt, endedAt }).validateSync()?.errors.endedAt).toBeTruthy();
    expect(
      validRoleAssignment({
        state: 'CURRENT',
        endedAt: new Date('2026-07-03T00:00:00.000Z'),
      }).validateSync()?.errors.endedAt,
    ).toBeTruthy();
    expect(validRoleAssignment({ state: 'HISTORICAL' }).validateSync()).toBeUndefined();
    expect(
      validRoleAssignment({
        evidenceClaimIds: [duplicateEvidenceId, duplicateEvidenceId],
      }).validateSync()?.errors.evidenceClaimIds,
    ).toBeTruthy();
    expect(
      validRoleAssignment({
        evidenceClaimIds: Array.from({ length: 101 }, objectId),
      }).validateSync()?.errors.evidenceClaimIds,
    ).toBeTruthy();
  });

  it('indexes role assignments by person, target, state, and lifecycle', () => {
    expect(RoleAssignment.schema.indexes()).toContainEqual([
      {
        personId: 1,
        state: 1,
        archived: 1,
      },
      expect.any(Object),
    ]);
    expect(RoleAssignment.schema.indexes()).toContainEqual([
      {
        'target.kind': 1,
        'target.id': 1,
        state: 1,
        archived: 1,
      },
      expect.any(Object),
    ]);
    expect(RoleAssignment.schema.path('role')).toBeTruthy();
    expect(Person.schema.path('role')).toBeUndefined();
  });

  it('allows repeated historical terms instead of treating a role as permanent person identity', () => {
    const personId = objectId();
    const targetId = objectId();
    const firstTerm = validRoleAssignment({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: targetId },
      state: 'HISTORICAL',
      startedAt: new Date('2020-01-01T00:00:00.000Z'),
      endedAt: new Date('2021-01-01T00:00:00.000Z'),
    });
    const secondTerm = validRoleAssignment({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: targetId },
      state: 'HISTORICAL',
      startedAt: new Date('2022-01-01T00:00:00.000Z'),
      endedAt: new Date('2023-01-01T00:00:00.000Z'),
    });

    expect(firstTerm.validateSync()).toBeUndefined();
    expect(secondTerm.validateSync()).toBeUndefined();
    expect(RoleAssignment.schema.indexes().some(([, options]) => options.unique)).toBe(false);
  });

  it('enforces bounded, case-insensitively unique OrgUnit aliases', () => {
    expect(
      validOrgUnit({ aliases: ['Yale CS', ' yale cs '] }).validateSync()?.errors.aliases,
    ).toBeTruthy();
    expect(
      validOrgUnit({
        aliases: Array.from({ length: 21 }, (_, index) => `Alias ${index}`),
      }).validateSync()?.errors.aliases,
    ).toBeTruthy();
  });

  it('enforces bounded, case-insensitively unique TaxonomyTerm aliases', () => {
    expect(
      validTaxonomyTerm({
        aliases: ['Machine Intelligence', 'machine intelligence'],
      }).validateSync()?.errors.aliases,
    ).toBeTruthy();
    expect(
      validTaxonomyTerm({
        aliases: Array.from({ length: 31 }, (_, index) => `Alias ${index}`),
      }).validateSync()?.errors.aliases,
    ).toBeTruthy();
  });

  it('uses kind plus normalized label as the TaxonomyTerm uniqueness boundary', () => {
    expect(TaxonomyTerm.schema.indexes()).toContainEqual([
      {
        kind: 1,
        normalizedLabel: 1,
      },
      expect.objectContaining({ unique: true }),
    ]);
    expect(validTaxonomyTerm({ normalizedLabel: ' MACHINE LEARNING ' }).normalizedLabel).toBe(
      'machine learning',
    );
    expect(
      validTaxonomyTerm({ normalizedLabel: 'deep learning' }).validateSync()?.errors
        .normalizedLabel,
    ).toBeTruthy();
    expect(validTaxonomyTerm({ normalizedLabel: undefined }).normalizedLabel).toBe(
      'machine learning',
    );
    expect(
      validTaxonomyTerm({ aliases: [' machine   learning '] }).validateSync()?.errors.aliases,
    ).toBeTruthy();
  });

  it('registers canonical identity indexes without requiring collection creation', () => {
    expect(Account.schema.indexes()).toContainEqual([
      { netid: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(OrgUnit.schema.indexes()).toContainEqual([
      { slug: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(Person.schema.indexes()).toContainEqual([
      { 'identifiers.orcid': 1 },
      expect.objectContaining({ unique: true, sparse: true }),
    ]);
  });

  it('rejects self-parenting canonical reference records', () => {
    const orgUnit = validOrgUnit();
    orgUnit.parentOrgUnitId = orgUnit._id;
    expect(orgUnit.validateSync()?.errors.parentOrgUnitId).toBeTruthy();

    const taxonomyTerm = validTaxonomyTerm();
    taxonomyTerm.parentTermId = taxonomyTerm._id;
    expect(taxonomyTerm.validateSync()?.errors.parentTermId).toBeTruthy();
  });

  it('reuses the existing ResearchEntityRelationship model and physical collection', () => {
    expect(ResearchEntityRelationship.modelName).toBe('ResearchEntityRelationship');
    expect(ResearchEntityRelationship.collection.name).toBe('research_entity_relationships');
    expect(mongoose.models.EntityRelationship).toBeUndefined();
  });

  it('exports all canonical models from the model barrel without collisions', () => {
    expect(modelExports.Account).toBe(Account);
    expect(modelExports.Person).toBe(Person);
    expect(modelExports.RoleAssignment).toBe(RoleAssignment);
    expect(modelExports.OrgUnit).toBe(OrgUnit);
    expect(modelExports.TaxonomyTerm).toBe(TaxonomyTerm);
    expect(modelExports.ResearchEntityRelationship).toBe(ResearchEntityRelationship);
  });
});
