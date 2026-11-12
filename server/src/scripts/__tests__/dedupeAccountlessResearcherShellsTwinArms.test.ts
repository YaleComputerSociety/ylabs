import { describe, expect, it } from 'vitest';
import {
  decideOfficialPageWitnessFold,
  decideShellMerge,
  emaillessLocalPartTwinAliases,
  foldsArchivingOnlyLiveLead,
  normalizeResearcherName,
  officialPageWitnessDestination,
  planAccountlessClusterFolds,
  planAliasTwinFolds,
  planShellEdgeMoves,
  profileHolderSurnamesAgree,
  researcherNameMatchKey,
  uninvertedPersonName,
  buildCanonicalNameIndex,
  type OfficialPageCandidate,
  type OfficialPageHolders,
} from '../dedupeAccountlessResearcherShellsCore';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);
const SYNTHETIC_ORCID_2 = syntheticPersonOrcid(501);
const SYNTHETIC_ORCID_3 = syntheticPersonOrcid(502);

describe('uninvertedPersonName (#5606)', () => {
  it('reads a "Surname, Given" display name in reading order', () => {
    expect(uninvertedPersonName('Synth, Avery')).toBe('Avery Synth');
    expect(uninvertedPersonName('Synth, Avery Jo')).toBe('Avery Jo Synth');
    expect(normalizeResearcherName('Synth, Avery')).toBe('avery synth');
  });

  it('keeps a credential or generational suffix after the comma as roster noise', () => {
    expect(uninvertedPersonName('Avery Synth, PhD')).toBe('Avery Synth, PhD');
    expect(uninvertedPersonName('Synth, PhD')).toBe('Synth, PhD');
    expect(uninvertedPersonName('Synth, Jr.')).toBe('Synth, Jr.');
    expect(uninvertedPersonName('Synth, M.D.')).toBe('Synth, M.D.');
    expect(uninvertedPersonName('Synth, MD, PhD')).toBe('Synth, MD, PhD');
  });

  it('leaves an initial-only given name and a multi-token surname alone', () => {
    expect(uninvertedPersonName('Synth, A.')).toBe('Synth, A.');
    expect(uninvertedPersonName('Van Synth, Avery')).toBe('Van Synth, Avery');
  });

  it('lets the surname veto see the surname of an inverted name', () => {
    expect(profileHolderSurnamesAgree('Synth, Avery', 'Avery Synth')).toBe(true);
    expect(profileHolderSurnamesAgree('Synth, Avery', 'Avery Synthe')).toBe(false);
  });
});

describe('researcherNameMatchKey (#5606)', () => {
  it('closes up a two-word given name so both spellings key one record', () => {
    expect(researcherNameMatchKey('Ji Yeon Fixture')).toBe('jiyeon fixture');
    expect(researcherNameMatchKey('Jiyeon Fixture')).toBe('jiyeon fixture');
  });

  it('never closes up initials or a single given name', () => {
    expect(researcherNameMatchKey('J. R. Fixture')).toBe('j. r. fixture');
    expect(researcherNameMatchKey('Jiyeon Fixture')).not.toBe(
      researcherNameMatchKey('Jiye Fixture'),
    );
  });

  it('plans the exact-name fold for a spacing variant and not for a different given name', () => {
    const index = buildCanonicalNameIndex([
      { id: 'holder', displayName: 'Ji Yeon Fixture', email: 'jiyeon.fixture@yale.edu' },
    ]);
    expect(decideShellMerge({ id: 'shell', displayName: 'Jiyeon Fixture' }, index)).toMatchObject({
      merge: true,
      canonicalId: 'holder',
      matchedOn: 'name',
    });
    expect(decideShellMerge({ id: 'other', displayName: 'Jiwon Fixture' }, index).merge).toBe(
      false,
    );
  });
});

describe('officialPageWitnessDestination (#5606)', () => {
  it('reads a YSM lab microsite profile as the school profile with the same slug', () => {
    expect(
      officialPageWitnessDestination('medicine.yale.edu/lab/fixture/profile/avery-synth'),
    ).toBe('medicine.yale.edu/profile/avery-synth');
  });

  it('never equates a different slug under the lab path', () => {
    expect(
      officialPageWitnessDestination('medicine.yale.edu/lab/fixture/profile/avery-synthe'),
    ).not.toBe('medicine.yale.edu/profile/avery-synth');
  });

  it('reads a YSM center copy of a profile as the school profile with the same slug (#5932)', () => {
    expect(
      officialPageWitnessDestination('medicine.yale.edu/fixturecenter/profile/avery-synth'),
    ).toBe('medicine.yale.edu/profile/avery-synth');
  });

  it('never reads a deeper path or a different host as a center copy', () => {
    for (const destination of [
      'medicine.yale.edu/fixturecenter/people/profile/avery-synth',
      'publichealth.yale.edu/fixturecenter/profile/avery-synth',
    ]) {
      expect(officialPageWitnessDestination(destination)).toBe(destination);
    }
  });

  it('leaves every other destination unchanged', () => {
    for (const destination of [
      'medicine.yale.edu/profile/avery-synth',
      'medicine.yale.edu/lab/fixture',
      'medicine.yale.edu/lab/fixture/people',
      'economics.yale.edu/people/avery-synth',
      'other.yale.edu/lab/fixture/profile/avery-synth',
    ]) {
      expect(officialPageWitnessDestination(destination)).toBe(destination);
    }
  });
});

const directoryHolder = (overrides: Partial<OfficialPageCandidate> = {}): OfficialPageCandidate => {
  const netid = overrides.netid ?? 'fx901';
  return {
    id: 'holder',
    displayName: 'Avery Synth',
    netid,
    email: `${netid}@yale.edu`,
    tier: 'DIRECTORY',
    ...overrides,
  };
};

const holdersOf = (...candidates: OfficialPageCandidate[]): OfficialPageHolders => ({
  byEmail: new Map(candidates.map((candidate) => [candidate.email!, [candidate]])),
  byOrcid: new Map(
    candidates
      .filter((candidate) => candidate.orcid)
      .map((candidate) => [candidate.orcid!, [candidate]]),
  ),
});

describe('decideOfficialPageWitnessFold (#5606)', () => {
  const shell = { id: 'shell', displayName: 'Avi Synth' };

  it('folds a name-only shell into the directory record whose stored email its page states', () => {
    expect(
      decideOfficialPageWitnessFold(
        shell,
        [{ emails: ['FX901@yale.edu'], orcids: [] }],
        holdersOf(directoryHolder()),
      ),
    ).toEqual({
      merge: true,
      canonicalId: 'holder',
      reason: 'MERGEABLE',
      matchedOn: 'official-page',
    });
  });

  it('folds on the one ORCID a page states', () => {
    const holder = directoryHolder({ orcid: SYNTHETIC_ORCID_1 });
    expect(
      decideOfficialPageWitnessFold(
        shell,
        [{ emails: [], orcids: [SYNTHETIC_ORCID_1] }],
        holdersOf(holder),
      )?.merge,
    ).toBe(true);
  });

  it('takes no ORCID witness from a page that states two distinct ORCIDs', () => {
    const holder = directoryHolder({ orcid: SYNTHETIC_ORCID_1 });
    expect(
      decideOfficialPageWitnessFold(
        shell,
        [{ emails: [], orcids: [SYNTHETIC_ORCID_1, SYNTHETIC_ORCID_2] }],
        holdersOf(holder),
      ),
    ).toBeUndefined();
  });

  it("takes no ORCID witness from a page whose stated email is not the holder's", () => {
    const holder = directoryHolder({ orcid: SYNTHETIC_ORCID_1 });
    const page = { emails: ['avery.other@yale.edu'], orcids: [SYNTHETIC_ORCID_1] };
    expect(decideOfficialPageWitnessFold(shell, [page], holdersOf(holder))).toBeUndefined();
    expect(
      decideOfficialPageWitnessFold(
        shell,
        [{ ...page, directoryNetids: ['fx901'] }],
        holdersOf(holder),
      )?.merge,
    ).toBe(true);
  });

  it('refuses a similarly named different person through the surname veto', () => {
    expect(
      decideOfficialPageWitnessFold(
        { id: 'shell', displayName: 'Avery Synthe' },
        [{ emails: ['fx901@yale.edu'], orcids: [] }],
        holdersOf(directoryHolder()),
      ),
    ).toBeUndefined();
  });

  it('refuses a trainee shell against a professor holder', () => {
    expect(
      decideOfficialPageWitnessFold(
        { ...shell, title: 'Postdoctoral Associate' },
        [{ emails: ['fx901@yale.edu'], orcids: [] }],
        holdersOf(directoryHolder({ title: 'Professor of Fixture Studies' })),
      ),
    ).toBeUndefined();
  });

  it('resolves to nobody when a page witnesses two directory records', () => {
    expect(
      decideOfficialPageWitnessFold(
        shell,
        [{ emails: ['fx901@yale.edu', 'fx902@yale.edu'], orcids: [] }],
        holdersOf(directoryHolder(), directoryHolder({ id: 'holder-2', netid: 'fx902' })),
      ),
    ).toMatchObject({ merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL' });
  });

  it('never folds two distinct ORCIDs, and never treats a directory record as a shell', () => {
    const holders = holdersOf(directoryHolder({ orcid: SYNTHETIC_ORCID_1 }));
    const statements = [{ emails: ['fx901@yale.edu'], orcids: [] }];
    expect(
      decideOfficialPageWitnessFold({ ...shell, orcid: SYNTHETIC_ORCID_3 }, statements, holders),
    ).toMatchObject({ merge: false, reason: 'ORCID_CONFLICT' });
    expect(
      decideOfficialPageWitnessFold(
        { ...shell, email: 'avery.other@yale.edu' },
        statements,
        holders,
      ),
    ).toBeUndefined();
  });
});

describe('emaillessLocalPartTwinAliases (#5606)', () => {
  const holder = { id: 'holder', netid: 'fx901', email: 'avery.synth@yale.edu' };

  it('aliases an emailless local-part netid to the one directory record storing that address', () => {
    expect(emaillessLocalPartTwinAliases([holder, { id: 'twin', netid: 'Avery.Synth' }])).toEqual(
      new Map([['avery.synth', 'fx901']]),
    );
  });

  it('ignores a twin that stores an email, a bare netid, and an address two records store', () => {
    expect(
      emaillessLocalPartTwinAliases([
        holder,
        { id: 'twin', netid: 'avery.synth', email: 'avery.alt@yale.edu' },
      ]),
    ).toEqual(new Map());
    expect(emaillessLocalPartTwinAliases([holder, { id: 'twin', netid: 'fx901' }])).toEqual(
      new Map(),
    );
    expect(
      emaillessLocalPartTwinAliases([
        holder,
        { id: 'holder-2', netid: 'fx902', email: 'avery.synth@yale.edu' },
        { id: 'twin', netid: 'avery.synth' },
      ]),
    ).toEqual(new Map());
  });

  it('feeds the alias-twin plan, whose name and ORCID checks still veto', () => {
    const plan = (twinName: string, twinOrcid?: string) =>
      planAliasTwinFolds({
        twinResearchers: [
          { id: 'twin', netid: 'avery.synth', displayName: twinName, orcid: twinOrcid },
        ],
        researcherByNetid: new Map([
          ['fx901', { id: 'holder', displayName: 'Avery Synth', orcid: SYNTHETIC_ORCID_1 }],
        ]),
        aliasNetidByTwinNetid: new Map([['avery.synth', 'fx901']]),
        loginNetids: new Set(),
      });
    expect(plan('A. B. Avery Synth').targetByTwinResearcherId.get('twin')).toBe('holder');
    expect(plan('Avery Synthe').refusals['names-disagree']).toBe(1);
    expect(plan('Avery Synth', SYNTHETIC_ORCID_3).refusals['orcid-conflict']).toBe(1);
  });
});

describe('accountless cluster on an inverted display name (#5606)', () => {
  const member = (id: string, displayName: string, extra: Record<string, unknown> = {}) => ({
    id,
    displayName,
    primaryDepartment: 'Fixture Studies',
    liveRoleEdges: 1,
    ...extra,
  });

  it('groups "Surname, Given" with "Given Surname" in one department', () => {
    const plan = planAccountlessClusterFolds(
      [member('a', 'Avery Synth', { orcid: SYNTHETIC_ORCID_1 }), member('b', 'Synth, Avery')],
      [],
    );
    expect(plan.foldedGroups).toBe(1);
    expect(plan.foldTargetById.size).toBe(1);
  });

  it('keeps a similarly named different person apart', () => {
    const plan = planAccountlessClusterFolds(
      [member('a', 'Avery Synth'), member('b', 'Synthe, Avery')],
      [],
    );
    expect(plan.groups).toBe(0);
  });
});

describe('foldsArchivingOnlyLiveLead (#5606)', () => {
  const leadRoles = new Set(['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR']);
  const shellLead = {
    id: 'e-shell',
    personId: 'shell',
    targetKind: 'RESEARCH_ENTITY',
    targetId: 'row',
    role: 'PI',
    state: 'UNKNOWN',
  };
  const survivorLead = { ...shellLead, id: 'e-survivor', personId: 'holder' };
  const targets = new Map([['shell', 'holder']]);

  it('refuses a fold that archives the shell lead against a detached survivor edge', () => {
    const movesByShell = planShellEdgeMoves([shellLead], [survivorLead], targets);
    expect(movesByShell.get('shell')?.archivedRedundant).toEqual(['e-shell']);
    expect(
      foldsArchivingOnlyLiveLead({
        movesByShell,
        shellEdges: [shellLead],
        liveLeadEdges: [shellLead],
        leadRoles,
      }),
    ).toEqual(new Set(['shell']));
  });

  it('allows the fold when the survivor still holds a live lead on the row', () => {
    const movesByShell = planShellEdgeMoves([shellLead], [survivorLead], targets);
    expect(
      foldsArchivingOnlyLiveLead({
        movesByShell,
        shellEdges: [shellLead],
        liveLeadEdges: [shellLead, survivorLead],
        leadRoles,
      }),
    ).toEqual(new Set());
  });

  it('allows a fold that repoints the shell lead, and ignores a non-lead or historical edge', () => {
    const repointed = planShellEdgeMoves([shellLead], [], targets);
    expect(
      foldsArchivingOnlyLiveLead({
        movesByShell: repointed,
        shellEdges: [shellLead],
        liveLeadEdges: [shellLead],
        leadRoles,
      }),
    ).toEqual(new Set());
    for (const edge of [
      { ...shellLead, role: 'CORE_FACULTY' },
      { ...shellLead, state: 'HISTORICAL' },
    ]) {
      const movesByShell = planShellEdgeMoves(
        [edge],
        [{ ...edge, id: 'e-survivor', personId: 'holder' }],
        targets,
      );
      expect(
        foldsArchivingOnlyLiveLead({
          movesByShell,
          shellEdges: [edge],
          liveLeadEdges: [edge],
          leadRoles,
        }),
      ).toEqual(new Set());
    }
  });
});
