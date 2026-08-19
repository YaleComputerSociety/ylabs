import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ORG_UNIT_READ_FIELDS,
  CANONICAL_PERSON_READ_FIELDS,
  CANONICAL_PUBLIC_EVIDENCE_READ_FIELDS,
  CANONICAL_RESEARCH_PLAN_READ_FIELDS,
  CANONICAL_ROLE_READ_FIELDS,
  CANONICAL_TAXONOMY_READ_FIELDS,
  CanonicalReadAuthorizationError,
  MAX_CANONICAL_LOADER_IDS,
  createCanonicalDomainLoaders,
  type CanonicalReadModel,
  type CanonicalReadModels,
} from '../canonicalDomainLoaders';

interface QueryCall {
  filter: Record<string, unknown>;
  fields?: string;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

function fakeModel(rows: Record<string, unknown>[] = []): {
  model: CanonicalReadModel;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const model: CanonicalReadModel = {
    find(filter) {
      const call: QueryCall = { filter };
      calls.push(call);
      const query = {
        select(fields: string) {
          call.fields = fields;
          return query;
        },
        sort(sort: Record<string, 1 | -1>) {
          call.sort = sort;
          return query;
        },
        limit(limit: number) {
          call.limit = limit;
          return query;
        },
        lean() {
          return query;
        },
        async exec() {
          return rows;
        },
      };
      return query;
    },
  };
  return { model, calls };
}

function fixture() {
  const EvidenceClaim = fakeModel([{ predicate: 'ENTITY_HAS_DESCRIPTION' }]);
  const OrgUnit = fakeModel([{ name: 'Computer Science' }]);
  const Researcher = fakeModel([{ displayName: 'Grace Hopper' }]);
  const ResearchPlan = fakeModel([{ stage: 'SAVED' }]);
  const RoleAssignment = fakeModel([{ role: 'PI' }]);
  const TaxonomyTerm = fakeModel([{ label: 'Machine Learning' }]);
  const models: CanonicalReadModels = {
    EvidenceClaim: EvidenceClaim.model,
    OrgUnit: OrgUnit.model,
    Researcher: Researcher.model,
    ResearchPlan: ResearchPlan.model,
    RoleAssignment: RoleAssignment.model,
    TaxonomyTerm: TaxonomyTerm.model,
  };
  return {
    loaders: createCanonicalDomainLoaders(models),
    EvidenceClaim,
    OrgUnit,
    Researcher,
    ResearchPlan,
    RoleAssignment,
    TaxonomyTerm,
  };
}

const ids = {
  account: new mongoose.Types.ObjectId('507f191e810c19729de86001'),
  otherAccount: new mongoose.Types.ObjectId('507f191e810c19729de86002'),
  person: new mongoose.Types.ObjectId('507f191e810c19729de86003'),
  entity: new mongoose.Types.ObjectId('507f191e810c19729de86004'),
  orgUnit: new mongoose.Types.ObjectId('507f191e810c19729de86005'),
  taxonomy: new mongoose.Types.ObjectId('507f191e810c19729de86006'),
};

describe('canonical domain loaders', () => {
  it('loads only public person identity fields and rejects object-shaped id coercion', async () => {
    const { loaders, Researcher } = fixture();

    await expect(loaders.loadPublicPeopleByIds([ids.person.toHexString()])).resolves.toEqual([
      { displayName: 'Grace Hopper' },
    ]);
    expect(Researcher.calls[0]).toMatchObject({
      filter: {
        _id: { $in: [ids.person] },
        archived: false,
        status: { $in: ['ACTIVE', 'UNKNOWN'] },
      },
      fields: CANONICAL_PERSON_READ_FIELDS,
      limit: 1,
    });
    expect(Researcher.calls[0].fields).not.toMatch(/accountId|identifiers/);

    await expect(
      loaders.loadPublicPeopleByIds([
        {
          toString: () => ids.person.toHexString(),
        } as unknown as string,
      ]),
    ).rejects.toThrow(/valid ObjectId/);
  });

  it('deduplicates ids and rejects loader fan-out above the explicit bound', async () => {
    const { loaders, OrgUnit } = fixture();

    await loaders.loadActiveOrgUnitsByIds([ids.orgUnit, ids.orgUnit.toHexString()]);
    expect(OrgUnit.calls[0].limit).toBe(1);
    expect((OrgUnit.calls[0].filter._id as { $in: unknown[] }).$in).toHaveLength(1);

    await expect(
      loaders.loadActiveOrgUnitsByIds(
        Array.from({ length: MAX_CANONICAL_LOADER_IDS + 1 }, () => ids.orgUnit),
      ),
    ).rejects.toThrow(`at most ${MAX_CANONICAL_LOADER_IDS}`);
  });

  it('loads only approved current non-archived roles for explicit canonical targets', async () => {
    const { loaders, RoleAssignment } = fixture();

    await loaders.loadCurrentApprovedRolesForTargets([
      { kind: 'RESEARCH_ENTITY', id: ids.entity },
      { kind: 'RESEARCH_ENTITY', id: ids.entity.toHexString() },
    ]);

    expect(RoleAssignment.calls[0]).toMatchObject({
      filter: {
        $or: [
          {
            'target.kind': 'RESEARCH_ENTITY',
            'target.id': ids.entity,
          },
        ],
        state: 'CURRENT',
        reviewStatus: 'APPROVED',
        archived: false,
        endedAt: { $exists: false },
      },
      fields: CANONICAL_ROLE_READ_FIELDS,
    });
    expect(RoleAssignment.calls[0].fields).not.toMatch(/evidenceClaimIds|confidence/);
  });

  it('loads active organizations and approved taxonomy terms with bounded reference aliases', async () => {
    const { loaders, OrgUnit, TaxonomyTerm } = fixture();

    await loaders.loadActiveOrgUnitsByIds([ids.orgUnit]);
    await loaders.loadApprovedTaxonomyTermsByIds([ids.taxonomy]);

    expect(OrgUnit.calls[0]).toMatchObject({
      filter: {
        _id: { $in: [ids.orgUnit] },
        status: 'ACTIVE',
        archived: false,
      },
      fields: CANONICAL_ORG_UNIT_READ_FIELDS,
    });
    expect(TaxonomyTerm.calls[0]).toMatchObject({
      filter: {
        _id: { $in: [ids.taxonomy] },
        reviewStatus: 'APPROVED',
        status: 'ACTIVE',
        archived: false,
      },
      fields: CANONICAL_TAXONOMY_READ_FIELDS,
    });
    expect(OrgUnit.calls[0].fields).toContain('aliases');
    expect(TaxonomyTerm.calls[0].fields).toContain('aliases');
  });

  it('loads only active public claim metadata without protected values or source documents', async () => {
    const { loaders, EvidenceClaim } = fixture();
    const before = new Date();

    await loaders.loadPublicEvidenceForSubjects([{ kind: 'RESEARCH_ENTITY', id: ids.entity }]);

    expect(EvidenceClaim.calls[0].filter).toMatchObject({
      $or: [
        {
          'subject.kind': 'RESEARCH_ENTITY',
          'subject.id': ids.entity,
        },
      ],
      sensitivity: 'PUBLIC',
      status: 'ACTIVE',
    });
    const observedAt = EvidenceClaim.calls[0].filter.observedAt as { $lte: Date };
    expect(observedAt.$lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(EvidenceClaim.calls[0]).toMatchObject({
      fields: CANONICAL_PUBLIC_EVIDENCE_READ_FIELDS,
      sort: { observedAt: -1, _id: 1 },
    });
    expect(EvidenceClaim.calls[0].fields).not.toMatch(
      /value|excerpt|sourceDocumentId|supersededByClaimId/,
    );
  });

  it('requires account ownership before any research-plan query', async () => {
    const { loaders, ResearchPlan } = fixture();

    await expect(
      loaders.loadOwnedResearchPlans({
        requesterAccountId: ids.account,
        ownerAccountId: ids.otherAccount,
      }),
    ).rejects.toBeInstanceOf(CanonicalReadAuthorizationError);
    expect(ResearchPlan.calls).toHaveLength(0);
  });

  it('scopes research plans to the owner and selects private fields only when explicit', async () => {
    const { loaders, ResearchPlan } = fixture();

    await loaders.loadOwnedResearchPlans({
      requesterAccountId: ids.account,
      ownerAccountId: ids.account.toHexString(),
      target: {
        kind: 'RESEARCH_ENTITY',
        ids: [ids.entity],
      },
      limit: 25,
    });
    await loaders.loadOwnedResearchPlans({
      requesterAccountId: ids.account,
      ownerAccountId: ids.account,
      includePrivateFields: true,
    });

    expect(ResearchPlan.calls[0]).toMatchObject({
      filter: {
        accountId: ids.account,
        archived: false,
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': { $in: [ids.entity] },
      },
      fields: CANONICAL_RESEARCH_PLAN_READ_FIELDS,
      sort: { updatedAt: -1, _id: 1 },
      limit: 25,
    });
    expect(ResearchPlan.calls[0].fields).not.toMatch(/privateNotes|checklist|deadlines/);
    expect(ResearchPlan.calls[1].fields).toBe(
      `${CANONICAL_RESEARCH_PLAN_READ_FIELDS} +privateNotes +checklist +deadlines`,
    );
  });

  it('rejects unbounded plan requests before querying MongoDB', async () => {
    const { loaders, ResearchPlan } = fixture();

    await expect(
      loaders.loadOwnedResearchPlans({
        requesterAccountId: ids.account,
        ownerAccountId: ids.account,
        limit: 101,
      }),
    ).rejects.toThrow(/limit/);
    expect(ResearchPlan.calls).toHaveLength(0);
  });
});
