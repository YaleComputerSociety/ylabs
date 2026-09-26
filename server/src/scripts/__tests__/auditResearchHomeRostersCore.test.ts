import { describe, expect, it } from 'vitest';
import {
  classifyOfficialRosterLane,
  missingConfiguredSections,
  officialRosterPrecision,
  snapshotDrift,
  summarizeResearchHomeRosterAudit,
  uncoveredCurrentSections,
  unmaterializedMembershipKeys,
  type OfficialRosterLaneEvidence,
} from '../auditResearchHomeRostersCore';
import { parseResearchHomeRosterAuditArgs, selectRosterConfigs } from '../auditResearchHomeRosters';

const NOW = new Date('2026-09-22T00:00:00.000Z');

function member(overrides: Partial<OfficialRosterLaneEvidence['members'][number]> = {}) {
  const profileUrl = overrides.profileUrl ?? 'https://medicine.yale.edu/lab/demo/profile/a-person/';
  return {
    name: 'Sample Person',
    title: 'Postdoctoral Associate',
    role: 'postdoc',
    sectionLabel: 'Postdoctoral Fellows',
    profileUrl,
    identityKey: `official-profile:${profileUrl.toLowerCase()}`,
    membershipKey: `official-profile:${profileUrl.toLowerCase()}|postdoc`,
    ...overrides,
  };
}

function lane(overrides: Partial<OfficialRosterLaneEvidence> = {}): OfficialRosterLaneEvidence {
  const members = overrides.members ?? [member()];
  return {
    researchEntityKey: 'demo-lab',
    url: 'https://medicine.yale.edu/lab/demo/people/',
    configuredSections: ['Postdoctoral Fellows'],
    reachability: 'HEALTHY',
    state: 'current',
    withheldCount: 0,
    duplicateCount: 0,
    sectionsOnPage: ['Postdoctoral Fellows'],
    entityExists: true,
    entityArchived: false,
    storedMembershipKeys: members.map((row) => row.membershipKey),
    materializedMembershipKeys: members.map((row) => row.membershipKey),
    expiredMaterializedRows: 0,
    storedFreshnessExpiresAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
    members,
  };
}

describe('research-home roster gate: structural verdicts', () => {
  it('reports ok when the page, the sections, the members and the stored rows all agree', () => {
    const finding = classifyOfficialRosterLane(lane(), NOW);
    expect(finding.verdict).toBe('ok');
  });

  it('calls a configured section that left the page a broken contract, not an empty roster', () => {
    const evidence = lane({ sectionsOnPage: ['Alumni'], state: 'withheld', members: [] });
    expect(missingConfiguredSections(evidence)).toEqual(['Postdoctoral Fellows']);
    expect(classifyOfficialRosterLane(evidence, NOW).verdict).toBe('section-contract-broken');
  });

  it('treats a former or alumni section as correctly excluded rather than coverage debt', () => {
    expect(
      uncoveredCurrentSections(
        lane({ sectionsOnPage: ['Postdoctoral Fellows', 'Former Members'] }),
      ),
    ).toEqual([]);
    expect(
      uncoveredCurrentSections(lane({ sectionsOnPage: ['Postdoctoral Fellows', 'Leadership'] })),
    ).toEqual(['Leadership']);
  });

  it('alarms on a past publish date, because the extractor then emits no members at all', () => {
    const finding = classifyOfficialRosterLane(
      lane({ state: 'stale', members: [], publishAgeDays: 700, storedMembershipKeys: [] }),
      NOW,
    );
    expect(finding.verdict).toBe('stale-publish-date');
  });

  it('only calls a lane unreachable when a server said the page is gone', () => {
    expect(classifyOfficialRosterLane(lane({ reachability: 'UNKNOWN' }), NOW).verdict).toBe('ok');
    expect(classifyOfficialRosterLane(lane({ reachability: 'REDIRECTED' }), NOW).verdict).toBe(
      'ok',
    );
    expect(
      classifyOfficialRosterLane(lane({ reachability: 'UNAVAILABLE', httpStatusCode: 404 }), NOW)
        .verdict,
    ).toBe('unreachable');
  });

  it('alarms when the configured entity key names no live row', () => {
    expect(classifyOfficialRosterLane(lane({ entityExists: false }), NOW).verdict).toBe(
      'entity-missing',
    );
    expect(classifyOfficialRosterLane(lane({ entityArchived: true }), NOW).verdict).toBe(
      'entity-missing',
    );
  });
});

describe('research-home roster gate: member precision', () => {
  it('catches a listing page stored as one person profile, the #2357 shape', () => {
    const listing = member({ profileUrl: 'https://medicine.yale.edu/lab/demo/people/faculty' });
    const precision = officialRosterPrecision(lane({ members: [listing] }));
    expect(precision.listingShapedProfileUrls).toBe(1);
    expect(classifyOfficialRosterLane(lane({ members: [listing] }), NOW).verdict).toBe(
      'member-precision-defect',
    );
  });

  it('catches the roster page itself stored as a profile even when it is not listing-shaped', () => {
    const rosterUrl = 'https://medicine.yale.edu/lab/demo/labmembers/';
    const evidence = lane({
      url: rosterUrl,
      members: [member({ profileUrl: rosterUrl })],
    });
    const precision = officialRosterPrecision(evidence);
    expect(precision.listingShapedProfileUrls).toBe(0);
    expect(precision.rosterUrlAsProfileUrl).toBe(1);
  });

  it('catches an off-host profile, a duplicated identity, and contact text in a member field', () => {
    const offHost = officialRosterPrecision(
      lane({ members: [member({ profileUrl: 'https://example.com/someone/' })] }),
    );
    expect(offHost.offHostProfileUrls).toBe(1);

    const duplicated = officialRosterPrecision(lane({ members: [member(), member()] }));
    expect(duplicated.duplicateIdentityKeys).toBe(1);

    const contact = officialRosterPrecision(
      lane({ members: [member({ title: 'Lab Manager, reach me at someone@example.com' })] }),
    );
    expect(contact.contactTextInMemberFields).toBe(1);

    const unmapped = officialRosterPrecision(lane({ members: [member({ role: '' })] }));
    expect(unmapped.unmappedRoles).toBe(1);
  });
});

describe('research-home roster gate: stored corpus', () => {
  it('alarms when a stored snapshot key carries no materialized current row', () => {
    const evidence = lane({ materializedMembershipKeys: [] });
    expect(unmaterializedMembershipKeys(evidence)).toHaveLength(1);
    expect(classifyOfficialRosterLane(evidence, NOW).verdict).toBe('membership-not-materialized');
  });

  it('reports an expired snapshot without alarming, because every snapshot expires by design', () => {
    const evidence = lane({
      storedFreshnessExpiresAt: '2026-09-18T00:00:00.000Z',
      expiredMaterializedRows: 2,
    });
    const finding = classifyOfficialRosterLane(evidence, NOW);
    expect(finding.verdict).toBe('snapshot-expired');
    expect(summarizeResearchHomeRosterAudit([evidence], { now: NOW })).toMatchObject({
      status: 'ok',
      brokenLanes: 0,
      expiredSnapshots: 1,
    });
  });

  it('measures drift in both directions between the page and the stored snapshot', () => {
    const onPage = member({ profileUrl: 'https://medicine.yale.edu/lab/demo/profile/new-person/' });
    expect(
      snapshotDrift(lane({ members: [onPage], storedMembershipKeys: ['stale-key|postdoc'] })),
    ).toEqual({ addedOnPage: 1, goneFromPage: 1 });
  });
});

describe('research-home roster gate: enablement readiness', () => {
  it('withholds broad enablement until structure is clean AND a sample review is recorded', () => {
    const clean = [lane()];
    expect(summarizeResearchHomeRosterAudit(clean, { now: NOW }).broadEnablementReady).toBe(false);
    expect(
      summarizeResearchHomeRosterAudit(clean, {
        now: NOW,
        sampledPrecisionReviewedBy: 'data operations',
      }).broadEnablementReady,
    ).toBe(true);
    expect(
      summarizeResearchHomeRosterAudit([lane({ entityExists: false })], {
        now: NOW,
        sampledPrecisionReviewedBy: 'data operations',
      }).broadEnablementReady,
    ).toBe(false);
  });

  it('bounds the sample and keeps it out of the summary unless asked for', () => {
    const report = summarizeResearchHomeRosterAudit(
      [lane({ members: [member(), member(), member()] })],
      { now: NOW, sampleLimit: 2 },
    );
    expect(report.sample).toHaveLength(2);
    expect(summarizeResearchHomeRosterAudit([lane()], { now: NOW }).sample).toBeUndefined();
  });
});

describe('research-home roster gate: CLI arguments', () => {
  it('refuses a sample with nowhere safe to write it', () => {
    expect(() => parseResearchHomeRosterAuditArgs(['--sample-limit=5'])).toThrow(
      '--sample-limit requires --output',
    );
  });

  it('bounds the sample limit and rejects an unknown flag or an empty reviewer', () => {
    expect(() => parseResearchHomeRosterAuditArgs(['--sample-limit=101'])).toThrow(
      '--sample-limit requires an integer between 0 and 100',
    );
    expect(() => parseResearchHomeRosterAuditArgs(['--sampled-precision-reviewed-by='])).toThrow(
      '--sampled-precision-reviewed-by requires a reviewer',
    );
    expect(() => parseResearchHomeRosterAuditArgs(['--nope'])).toThrow('Unknown argument: --nope');
    expect(parseResearchHomeRosterAuditArgs(['--strict'])).toMatchObject({
      strict: true,
      sampleLimit: 0,
    });
  });

  it('fails on an unknown roster key rather than auditing fewer lanes than asked for', () => {
    const configs = [
      {
        researchEntityKey: 'demo-lab',
        url: 'https://example.org/people/',
        currentSectionLabels: [],
      },
    ];
    expect(selectRosterConfigs(configs, new Set(['demo-lab']))).toHaveLength(1);
    expect(() => selectRosterConfigs(configs, new Set(['demo-lab', 'nope']))).toThrow(
      '--only names no roster config: nope',
    );
  });
});
