import { describe, it, expect } from 'vitest';
import { normalizeOfficialProfileDestination } from '../../services/leadProfileIdentity';
import {
  isPersonProfileIdentityUrl,
  planStaffMintedEntityRetirement,
  officialProfileUrlSpellings,
  soleLeadIdentityFor,
  staffMintedEntityReasonFor,
  summarizeStaffMintedEntityRefusals,
  type StaffMintedEntityCandidate,
} from '../retireStaffMintedResearchEntitiesCore';

const candidate = (over: Partial<StaffMintedEntityCandidate> = {}): StaffMintedEntityCandidate => ({
  id: 'a'.repeat(24),
  entityType: 'FACULTY_RESEARCH_AREA',
  tier: 'student_ready',
  identityProfileUrl: 'https://medicine.example.edu/profile/a-person/',
  storedTitles: ['Laboratory Assistant 3'],
  manuallyLockedFields: [],
  visibilityOverrideTier: null,
  operatorProvenanceSourceNames: [],
  hasForeignWebsite: false,
  identityPersonIds: ['b'.repeat(24)],
  roleEdgePersonIds: [],
  ...over,
});

describe('staffMintedEntityReasonFor', () => {
  it('names which screen refuses the title', () => {
    expect(staffMintedEntityReasonFor('Building Maintenance Supervisor')).toBe(
      'non_research_staff_title',
    );
    expect(staffMintedEntityReasonFor('Laboratory Assistant 3')).toBe(
      'research_support_staff_title',
    );
  });

  it('says nothing about a title that owns research', () => {
    expect(staffMintedEntityReasonFor('Professor of Immunobiology')).toBeUndefined();
    expect(staffMintedEntityReasonFor(undefined)).toBeUndefined();
  });

  // Archiving cannot be undone by re-scraping, so the yield is the blunt whole-title
  // question: any title that states a faculty appointment anywhere keeps its row,
  // whatever else the title states and however the clauses are joined. The last three
  // cases are the ones `isFacultyTitle` cannot answer, because it short-circuits on
  // `looksLikeNonResearchTitle` and would read them as staff.
  it('yields to any title that states a faculty appointment', () => {
    for (const title of [
      'Professor of Psychiatry and of Neuroscience; Research Assistant',
      'Lecturer in American Religious History; Special Collections Librarian',
      'Associate Professor of Pathology; Laboratory Supervisor',
      'Research Scientist in Chemistry; Research Affiliate',
      'Visiting Assistant Professor',
      'Visiting Assistant Professor of Political Science',
      'Visiting Fellow and Lecturer in Law',
      'Lecturer and Research Affiliate',
      'Professor of Molecular Biophysics and Biochemistry and Lab Manager',
      'Associate Professor of Medicine; Clinical Program Manager',
      'Clinical Professor and Nurse Practitioner',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBeUndefined();
    }
  });

  // A ruled trainee rank retires however it is spelled. The hyphenated pair is the
  // reason it is decided before the faculty-keyword yield: `FACULTY_KEYWORDS` holds
  // `postdoc` but not `post-doc`, and no irreversible archive should turn on a hyphen.
  it('retires every rank the owner ruled cannot host, whatever its spelling', () => {
    for (const title of [
      'Postdoctoral Associate',
      'Post-Doctoral Fellow',
      'postdoc in Immunobiology',
      'Research Associate',
      'Research Associate 2, HSS',
      'Research Assistant, YSPH',
      'Visiting Fellow',
      'Visiting Scholar',
      'Visiting Researcher',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBe('non_hosting_trainee_title');
    }
  });

  it('keeps a trainee rank held beside an appointment that can host', () => {
    for (const title of [
      'Postdoctoral Associate & Lecturer',
      'Visiting Fellow and Lecturer in Law',
      'Visiting Assistant Professor of Political Science',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBeUndefined();
    }
  });

  it('leaves research scientists and the ranks awaiting a ruling out of the population', () => {
    for (const title of [
      'Associate Research Scientist in Neurology',
      'Postgraduate Associate',
      'Research Affiliate',
      'Resident',
      'Trainee',
      'Clinical Fellow',
      'Staff Affiliate - Hospital',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBeUndefined();
    }
  });

  it('spares a ruled rank named beside a rank still awaiting a ruling', () => {
    for (const title of [
      'Postdoctoral Associate and Clinical Fellow',
      'Research Associate; Resident',
      'Visiting Fellow and Staff Affiliate',
      'Postdoctoral Associate and Research Fellow',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBeUndefined();
    }
  });

  it('keeps the faculty-keyword yield ahead of the student class', () => {
    expect(staffMintedEntityReasonFor('PhD Student and Research Fellow')).toBeUndefined();
  });

  it('spares a trainee rank named as the population an administrator serves', () => {
    expect(
      staffMintedEntityReasonFor('Director, Postdoctoral Affairs and Career Services'),
    ).toBeUndefined();
  });

  // The narrowing does not empty the pass: the two classes it exists for still refuse.
  it('still refuses the support and non-research staff classes', () => {
    expect(staffMintedEntityReasonFor('Laboratory Assistant 3')).toBe(
      'research_support_staff_title',
    );
    expect(staffMintedEntityReasonFor('Histology Technician')).toBe('research_support_staff_title');
    expect(staffMintedEntityReasonFor('Building Maintenance Supervisor')).toBe(
      'non_research_staff_title',
    );
    expect(staffMintedEntityReasonFor('Athletic Operations Coordinator')).toBe(
      'non_research_staff_title',
    );
  });

  it('refuses every spelling a degree programme gives its students and graduates', () => {
    for (const title of [
      'Ph.D. Student',
      'PhD Student',
      'Graduate Student',
      'Graduate School Student',
      'IDE Student',
      'IDE Alumni',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBe('student_title');
    }
  });

  it('spares a student title held beside a faculty appointment', () => {
    expect(staffMintedEntityReasonFor('Lecturer and Ph.D. Student')).toBeUndefined();
  });

  it('spares a title that names students as the population it serves', () => {
    for (const title of [
      'Associate Director, PhD Graduate Student Affairs',
      'Associate Dean for Medical Student Affairs',
      'Chair, Graduate Student Committee',
      'Director of Medical Student Education',
      'Graduate Student Advisor',
    ]) {
      expect(staffMintedEntityReasonFor(title)).not.toBe('student_title');
    }
  });

  it('archives no row whose only title administers students', () => {
    for (const title of [
      'Associate Dean for Medical Student Affairs',
      'Chair, Graduate Student Committee',
      'Director of Medical Student Education',
    ]) {
      const plan = planStaffMintedEntityRetirement([candidate({ storedTitles: [title] })]);
      expect(plan.toArchive).toEqual([]);
    }
  });
});

describe('isPersonProfileIdentityUrl', () => {
  it('accepts a person-scoped path and refuses anything else', () => {
    expect(isPersonProfileIdentityUrl('https://medicine.example.edu/profile/a-person/')).toBe(true);
    expect(isPersonProfileIdentityUrl('https://example.edu/people/a-person')).toBe(true);
    expect(isPersonProfileIdentityUrl('https://medicine.example.edu/lab/a-lab/')).toBe(false);
    // A shared roster page is nobody's own profile, so whichever person's title is
    // stored beside it must never decide a row's fate.
    expect(isPersonProfileIdentityUrl('https://chem.yale.edu/people/faculty')).toBe(false);
    expect(isPersonProfileIdentityUrl('https://medieval.yale.edu/people/core-faculty')).toBe(false);
    expect(
      isPersonProfileIdentityUrl('https://medicine.yale.edu/micropath/people/primary-faculty/'),
    ).toBe(false);
    expect(isPersonProfileIdentityUrl('https://medicine.example.edu/profile/')).toBe(false);
    expect(isPersonProfileIdentityUrl('not a url')).toBe(false);
    expect(isPersonProfileIdentityUrl(undefined)).toBe(false);
  });
});

describe('planStaffMintedEntityRetirement', () => {
  it('plans a row whose identity profile carries a refused title', () => {
    const plan = planStaffMintedEntityRetirement([candidate()]);
    expect(plan.toArchive).toEqual([
      {
        id: 'a'.repeat(24),
        reason: 'research_support_staff_title',
        entityType: 'FACULTY_RESEARCH_AREA',
        tier: 'student_ready',
        wasServed: true,
        selfRoleEdges: 0,
      },
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('refuses on every uncertainty rather than archiving', () => {
    const cases: Array<[Partial<StaffMintedEntityCandidate>, string]> = [
      [
        { identityProfileUrl: 'https://medicine.example.edu/lab/a-lab/' },
        'no-identity-profile-url',
      ],
      [{ identityProfileUrl: null }, 'no-identity-profile-url'],
      [{ storedTitles: ['   '] }, 'no-stored-title'],
      [{ storedTitles: [] }, 'no-stored-title'],
      [{ storedTitles: ['Professor of Immunobiology'] }, 'title-owns-research'],
      [
        { storedTitles: ['Laboratory Assistant 3', 'Professor of Immunobiology'] },
        'title-evidence-disagrees',
      ],
      [{ manuallyLockedFields: ['name'] }, 'manually-locked'],
      [{ visibilityOverrideTier: 'suppressed' }, 'operator-intent'],
      [{ operatorProvenanceSourceNames: ['operator-grounded-repair'] }, 'operator-intent'],
      [{ hasForeignWebsite: true }, 'has-foreign-website'],
      [{ roleEdgePersonIds: ['c'.repeat(24)] }, 'has-foreign-role-edge'],
      [{ identityPersonIds: [], roleEdgePersonIds: ['b'.repeat(24)] }, 'has-foreign-role-edge'],
    ];
    for (const [over, reason] of cases) {
      const plan = planStaffMintedEntityRetirement([candidate(over)]);
      expect(plan.toArchive).toEqual([]);
      expect(plan.refused).toEqual([{ id: 'a'.repeat(24), reason }]);
    }
  });

  it('re-derives the same verdict on a second pass', () => {
    const first = planStaffMintedEntityRetirement([candidate()]);
    const second = planStaffMintedEntityRetirement([candidate()]);
    expect(second.toArchive).toEqual(first.toArchive);
  });

  // Both directions of the disagreement the corpus actually holds: an award name
  // stored as a title, and a roster subheading that appends a support role to a
  // professorship, which the yield reads as owning research while the other lane's
  // title refuses.
  it('keeps a row when any one live title says the person owns research', () => {
    for (const titles of [
      ['Laboratory Assistant 3', 'Faculty Impact Award'],
      ['Professor of Psychiatry and of Neuroscience; Research Assistant', 'Laboratory Assistant 3'],
    ]) {
      const plan = planStaffMintedEntityRetirement([candidate({ storedTitles: titles })]);
      expect(plan.toArchive).toEqual([]);
      expect(summarizeStaffMintedEntityRefusals(plan.refused)['title-evidence-disagrees']).toBe(1);
    }
  });

  // One stored title, an appointment stated beside something a screen refuses. There
  // is no second title for unanimity to catch it with, and the archive is permanent.
  // The shapes differ only in how the clauses are joined and in which screen the
  // other clause trips, which is why the yield asks the whole title, directly.
  it('refuses a row whose only live title states a faculty appointment', () => {
    for (const title of [
      'Professor of Psychiatry and of Neuroscience; Research Assistant',
      'Visiting Assistant Professor of Political Science',
      'Visiting Fellow and Lecturer in Law',
      'Professor of Molecular Biophysics and Biochemistry and Lab Manager',
      'Associate Professor of Medicine; Clinical Program Manager',
      'Associate Research Scientist in Neurology',
    ]) {
      const plan = planStaffMintedEntityRetirement([candidate({ storedTitles: [title] })]);
      expect(plan.toArchive).toEqual([]);
      expect(plan.refused).toEqual([{ id: 'a'.repeat(24), reason: 'title-owns-research' }]);
    }
  });

  it('archives when every live title refuses, even from different screens', () => {
    const plan = planStaffMintedEntityRetirement([
      candidate({ storedTitles: ['Laboratory Assistant 3', 'Building Maintenance Supervisor'] }),
    ]);
    expect(plan.refused).toEqual([]);
    expect(plan.toArchive).toHaveLength(1);
  });

  // The reported reason has to be reproducible: storedTitles arrives in cursor order.
  it('labels a row by screen precedence rather than by which title came first', () => {
    const forward = planStaffMintedEntityRetirement([
      candidate({ storedTitles: ['Laboratory Assistant 3', 'Building Maintenance Supervisor'] }),
    ]);
    const reversed = planStaffMintedEntityRetirement([
      candidate({ storedTitles: ['Building Maintenance Supervisor', 'Laboratory Assistant 3'] }),
    ]);
    expect(forward.toArchive[0].reason).toBe('non_research_staff_title');
    expect(reversed.toArchive[0].reason).toBe('non_research_staff_title');
  });

  // The instrument that got this wrong first: counting edges refused 95 of 157 rows
  // and left every served defect in place, because the lane's own PI edge points at
  // the person whose profile it minted the row from.
  it('archives a row whose only edge attaches the person its identity page names', () => {
    const plan = planStaffMintedEntityRetirement([
      candidate({ roleEdgePersonIds: ['b'.repeat(24)] }),
    ]);
    expect(plan.refused).toEqual([]);
    expect(plan.toArchive[0].selfRoleEdges).toBe(1);
  });

  it('refuses when any one edge of several attaches somebody else', () => {
    const plan = planStaffMintedEntityRetirement([
      candidate({ roleEdgePersonIds: ['b'.repeat(24), 'c'.repeat(24)] }),
    ]);
    expect(plan.toArchive).toEqual([]);
    expect(plan.refused[0].reason).toBe('has-foreign-role-edge');
  });

  it('records a row that is not served as planned but not served', () => {
    const plan = planStaffMintedEntityRetirement([candidate({ tier: 'needs_review' })]);
    expect(plan.toArchive[0].wasServed).toBe(false);
  });
});

describe('soleLeadIdentityFor', () => {
  const roster = 'https://dept.example.edu/people/faculty';
  const page = 'https://dept.example.edu/profile/p-3001/';
  const verified = {
    kind: 'YALE_OFFICIAL',
    purpose: 'PRIMARY_IDENTITY',
    url: page,
    verifiedAt: new Date(),
  };
  const lead = (over: Record<string, unknown> = {}) =>
    new Map([
      ['p'.repeat(24), { profileLinks: [verified], title: 'Research Associate 3', ...over }],
    ]);
  const borrow = (over: Record<string, unknown> = {}) =>
    soleLeadIdentityFor({
      mintUrl: roster,
      rolePersonIds: ['p'.repeat(24)],
      leadById: lead(),
      observedTitlesByDestination: new Map(),
      ...over,
    });

  it('borrows the sole lead page and stored title for a row minted from a shared listing', () => {
    expect(borrow()).toEqual({
      url: page,
      titles: ['Research Associate 3'],
      personIds: ['p'.repeat(24)],
    });
  });

  it('prefers the live titles observed on the lead page over the stored title', () => {
    expect(
      borrow({
        observedTitlesByDestination: new Map([
          [normalizeOfficialProfileDestination(page), new Set(['Professor of Fixtures'])],
        ]),
      })!.titles,
    ).toEqual(['Professor of Fixtures']);
  });

  it('reads the live titles recorded under another spelling of the lead page', () => {
    const recordedAs = 'http://www.dept.example.edu/profile/p-3001';
    expect(officialProfileUrlSpellings(page)).toContain(recordedAs);
    const borrowed = borrow({
      observedTitlesByDestination: new Map([
        [
          normalizeOfficialProfileDestination(recordedAs),
          new Set(['Professor of Fixtures', 'Research Associate 3']),
        ],
      ]),
    })!;
    expect(borrowed.titles).toEqual(['Professor of Fixtures', 'Research Associate 3']);
    expect(
      planStaffMintedEntityRetirement([
        candidate({ identityProfileUrl: borrowed.url, storedTitles: borrowed.titles }),
      ]).toArchive,
    ).toEqual([]);
  });

  it('borrows nothing for two people, an unverified page, or a mint citation that is not a shared listing', () => {
    expect(borrow({ rolePersonIds: ['p'.repeat(24), 'q'.repeat(24)] })).toBeUndefined();
    expect(
      borrow({ leadById: lead({ profileLinks: [{ ...verified, verifiedAt: undefined }] }) }),
    ).toBeUndefined();
    expect(borrow({ mintUrl: page })).toBeUndefined();
  });

  it('feeds the same unanimity and yields as an observed title', () => {
    const borrowed = borrow()!;
    const plan = planStaffMintedEntityRetirement([
      candidate({
        identityProfileUrl: borrowed.url,
        storedTitles: borrowed.titles,
        identityPersonIds: borrowed.personIds,
        roleEdgePersonIds: borrowed.personIds,
      }),
    ]);
    expect(plan.toArchive.map((entry) => entry.reason)).toEqual(['non_hosting_trainee_title']);
    const professor = borrow({
      leadById: lead({ title: 'Associate Professor and Research Associate' }),
    })!;
    expect(
      planStaffMintedEntityRetirement([
        candidate({ identityProfileUrl: professor.url, storedTitles: professor.titles }),
      ]).toArchive,
    ).toEqual([]);
  });
});
