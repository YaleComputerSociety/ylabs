import { describe, expect, it } from 'vitest';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import {
  planBorrowedLabWebsiteRetirement,
  type LabWebsiteRow,
} from '../retireBorrowedLabWebsitesCore';

const labPage = 'https://medicine.example.edu/lab/topical/';
const row = (slug: string, overrides: Partial<LabWebsiteRow> = {}): LabWebsiteRow => ({
  entityId: `id-${slug}`,
  slug,
  leadPersonIds: [],
  leadNames: [],
  ...overrides,
});
const claim = (
  id: string,
  entityKey: string,
  value: string,
  sourceName = 'dept-faculty-roster',
) => ({
  observationId: id,
  entityKey,
  sourceName,
  value,
});
const ownedBy = (...owners: LabWebsiteRow[]) =>
  new Map(
    owners.map((owner) => [fieldValueRefusalKey('websiteUrl', owner.websiteUrl), [owner]] as const),
  );

const labOwner = row('lab-row', {
  websiteUrl: labPage,
  websiteUrlSourceName: 'ysm-atoz-index',
  leadPersonIds: ['lead'],
  leadNames: ['Alex Example'],
});

describe('planBorrowedLabWebsiteRetirement', () => {
  it("refuses a member's directory claim on a lab page a lab-level lane gives another lead", () => {
    const member = row('member-row', {
      websiteUrl: labPage,
      leadPersonIds: ['member'],
      leadNames: ['Sam Sample'],
    });
    const outcome = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage), claim('o2', 'member-row', labPage)],
      rowsBySlug: new Map([['member-row', member]]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(outcome.plans).toEqual([
      expect.objectContaining({
        slug: 'member-row',
        ownerSlug: 'lab-row',
        supersedeObservationIds: ['o1', 'o2'],
        refuse: true,
        clearStored: true,
      }),
    ]);
  });

  it('still refuses when the stored value is already empty, so the lane withdraws the lab name', () => {
    const outcome = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage)],
      rowsBySlug: new Map([['member-row', row('member-row')]]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(outcome.plans.map((plan) => [plan.refuse, plan.clearStored])).toEqual([[true, false]]);
  });

  it("leaves a co-lead's row for a merge rather than refusing it", () => {
    const outcome = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'co-lead-row', labPage, 'ysm-faculty-directory')],
      rowsBySlug: new Map([['co-lead-row', row('co-lead-row', { leadPersonIds: ['lead'] })]]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(outcome.plans).toEqual([]);
    expect(outcome.keptAsCoLeadTwin).toBe(1);
  });

  it("keeps a page named for the claimant's own lead, including a joint lab's site", () => {
    for (const site of [
      'https://www.samplelab.example.org/',
      'https://www.examplesamplelabs.example.org/',
    ]) {
      const outcome = planBorrowedLabWebsiteRetirement({
        claims: [claim('o1', 'own-row', site, 'ysm-faculty-directory')],
        rowsBySlug: new Map([['own-row', row('own-row', { leadNames: ['Sam Sample'] })]]),
        ownersByUrlKey: ownedBy({ ...labOwner, websiteUrl: site }),
        otherLaneSupport: new Set(),
      });
      expect(outcome.plans).toEqual([]);
      expect(outcome.keptAsNamedForClaimant).toBe(1);
    }
  });

  it('refuses nothing between two directory claims unless the page is named for the owner', () => {
    const directoryOwner = { ...labOwner, websiteUrlSourceName: 'ysm-faculty-directory' };
    const unnamed = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage)],
      rowsBySlug: new Map([['member-row', row('member-row')]]),
      ownersByUrlKey: ownedBy(directoryOwner),
      otherLaneSupport: new Set(),
    });
    expect(unnamed.plans).toEqual([]);
    expect(unnamed.keptWithoutAuthoritativeOwner).toBe(1);

    const namedPage = 'https://medicine.example.edu/lab/example/';
    const named = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', namedPage)],
      rowsBySlug: new Map([['member-row', row('member-row')]]),
      ownersByUrlKey: ownedBy({ ...directoryOwner, websiteUrl: namedPage }),
      otherLaneSupport: new Set(),
    });
    expect(named.plans.map((plan) => plan.ownerSlug)).toEqual(['lab-row']);
  });

  it('does not let a loose surname mention make a directory owner authoritative', () => {
    const jointSite = 'https://www.sampleexamplelabs.example.org/';
    const outcome = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', jointSite)],
      rowsBySlug: new Map([['member-row', row('member-row')]]),
      ownersByUrlKey: ownedBy({
        ...labOwner,
        websiteUrl: jointSite,
        websiteUrlSourceName: 'ysm-faculty-directory',
        leadNames: ['Sam Sample'],
      }),
      otherLaneSupport: new Set(),
    });
    expect(outcome.plans).toEqual([]);
  });

  it('keeps a page another lane gives the row, a locked website, and a page nobody else holds', () => {
    const supported = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage)],
      rowsBySlug: new Map([['member-row', row('member-row')]]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set([`member-row|${fieldValueRefusalKey('websiteUrl', labPage)}`]),
    });
    expect(supported.plans).toEqual([]);
    expect(supported.keptByOtherEvidence).toBe(1);

    const locked = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage)],
      rowsBySlug: new Map([
        ['member-row', row('member-row', { manuallyLockedFields: ['websiteUrl'] })],
      ]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(locked.plans).toEqual([]);

    const unheld = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'lab-row', labPage)],
      rowsBySlug: new Map([['lab-row', labOwner]]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(unheld.plans).toEqual([]);
  });

  it('does not re-record a refusal that already exists, but still supersedes the claim', () => {
    const outcome = planBorrowedLabWebsiteRetirement({
      claims: [claim('o1', 'member-row', labPage)],
      rowsBySlug: new Map([
        [
          'member-row',
          row('member-row', {
            fieldValueRefusals: {
              websiteUrl: [
                {
                  valueKey: fieldValueRefusalKey('websiteUrl', labPage),
                  value: labPage,
                  rule: 'wrong_owner',
                },
              ],
            },
          }),
        ],
      ]),
      ownersByUrlKey: ownedBy(labOwner),
      otherLaneSupport: new Set(),
    });
    expect(outcome.plans.map((plan) => [plan.refuse, plan.supersedeObservationIds])).toEqual([
      [false, ['o1']],
    ]);
  });
});
