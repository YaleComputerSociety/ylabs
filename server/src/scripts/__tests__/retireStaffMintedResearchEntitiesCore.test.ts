import { describe, it, expect } from 'vitest';
import {
  isPersonProfileIdentityUrl,
  planStaffMintedEntityRetirement,
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

  // A trainee rank is out of the population entirely, however it is spelled. The
  // hyphenated pair is the reason: `FACULTY_KEYWORDS` holds `postdoc` but not
  // `post-doc`, so a rank-based population archived one spelling and spared the other,
  // and no irreversible archive should turn on a hyphen. Those rows need their own
  // issue.
  it('leaves every trainee rank out of the population, whatever its spelling', () => {
    for (const title of [
      'Postdoctoral Associate',
      'Post-Doctoral Fellow',
      'Postgraduate Associate',
      'Research Associate',
      'Research Affiliate',
      'Visiting Scholar',
      'Visiting Researcher',
      'Associate Research Scientist in Neurology',
      'Graduate Student',
      'Resident',
      'Trainee',
      'Clinical Fellow',
    ]) {
      expect(staffMintedEntityReasonFor(title)).toBeUndefined();
    }
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
      'Postdoctoral Associate',
      'Post-Doctoral Fellow',
      'Associate Research Scientist in Neurology',
      'Graduate Student',
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
