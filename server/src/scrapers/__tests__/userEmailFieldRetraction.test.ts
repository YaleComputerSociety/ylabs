import { describe, expect, it } from 'vitest';
import {
  planUserFieldRetractions,
  userFieldRetractionContractFor,
  userFieldRetractionContracts,
  assertUserFieldRetractionContractsAreDeclarable,
  type UserFieldRetractionCandidateObservation,
  type UserPageRead,
} from '../fieldRetraction';
import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';
import {
  profileEnrichmentFromHtml,
  withoutSharedRosterEmails,
} from '../sources/departmentRosterScraper';

const SOURCE = 'official-profile-pi-backfill';
const KEY = 'netid:rq1';
const PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const OTHER_PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather-2/';
const contract = userFieldRetractionContractFor(SOURCE)!;

const at = (day: number) => new Date(Date.UTC(2026, 9, day));

const emailRow = (
  overrides: Partial<UserFieldRetractionCandidateObservation> = {},
): UserFieldRetractionCandidateObservation => ({
  observationId: 'obs-email',
  entityKey: KEY,
  field: 'email',
  value: 'rowan.quillfeather@yale.edu',
  scrapeRunId: 'run-1',
  observedAt: at(1),
  sourceUrl: PAGE,
  ...overrides,
});

const read = (runDay: number, claims: string[] = [], sourceUrl = PAGE): UserPageRead => ({
  entityKey: KEY,
  sourceUrl,
  scrapeRunId: `run-${runDay}`,
  observedAt: at(runDay),
  assertsNoValueFor: claims,
});

describe('user email field retraction planning (#5711)', () => {
  it('declares an email-only contract for exactly the two lanes that read a contact block', () => {
    expect(Object.keys(userFieldRetractionContracts).sort()).toEqual([
      'dept-faculty-roster',
      'official-profile-pi-backfill',
    ]);
    expect(() => assertUserFieldRetractionContractsAreDeclarable()).not.toThrow();
    expect(() =>
      assertUserFieldRetractionContractsAreDeclarable({
        lane: { retractableFields: ['title'], notes: '' },
      }),
    ).toThrow(/only email/);
  });

  it('retracts once two later reads of the same page attest it states no address', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1), read(2, ['email']), read(3, ['email'])],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([
      { entityKey: KEY, sourceUrl: PAGE, field: 'email', observationIds: ['obs-email'] },
    ]);
    expect(plan.counts.retractedSubjects).toBe(1);
  });

  it('waits for a second attesting read', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1), read(2, ['email'])],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.awaitingSecondCompleteRead).toBe(1);
  });

  it('never infers absence from a later read that merely omits the address (#2647)', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1), read(2), read(3)],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.absenceNotWitnessed).toBe(1);
  });

  it('does not let a claim about a different page retract the address', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1), read(2, ['email'], OTHER_PAGE), read(3, ['email'], OTHER_PAGE)],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.sourceHasNotReread).toBe(1);
  });

  it('retracts when the attesting reads file the person under a re-keyed key on the same page', () => {
    const rekeyed = (runDay: number): UserPageRead => ({
      ...read(runDay, ['email']),
      entityKey: 'dept:economics:rowan-quillfeather',
    });
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1), rekeyed(2), rekeyed(3)],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([
      { entityKey: KEY, sourceUrl: PAGE, field: 'email', observationIds: ['obs-email'] },
    ]);
  });

  it('does not count a claim from the run that stated the address', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(1, ['email']), read(2, ['email'])],
      activeObservations: [emailRow()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.awaitingSecondCompleteRead).toBe(1);
  });

  it('freezes the lane when most asserting pages would retract at once', () => {
    const pages = Array.from({ length: 20 }, (_unused, index) => `${PAGE}${index}/`);
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: pages.flatMap((page) => [
        read(1, [], page),
        read(2, ['email'], page),
        read(3, ['email'], page),
      ]),
      activeObservations: pages.map((page, index) =>
        emailRow({ observationId: `obs-${index}`, sourceUrl: page }),
      ),
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.frozenFields).toEqual([
      { sourceName: SOURCE, field: 'email', absentEntities: 20, assertingEntities: 20 },
    ]);
  });
});

const piProfile = (contact: string) => `
  <html>
    <head><link rel="canonical" href="${PAGE}" /></head>
    <body>
      <main>
        <h1>Rowan Quillfeather</h1>
        <div class="title">Professor of Fixture Studies</div>
        ${contact}
        <div class="department">Fixture Studies</div>
      </main>
      <footer class="site-footer"><a href="mailto:fixture.office@yale.edu">Office</a></footer>
    </body>
  </html>
`;
const piEntity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};
const piObservations = (contact: string) => {
  const identity = extractOfficialProfileIdentity(piProfile(contact), PAGE, piEntity, {
    requireEmail: false,
    expectedPeople: piEntity.leadUsers,
  });
  expect(identity).not.toBeNull();
  return identityToUserObservations(identity!, { netid: 'rq1' });
};
const piClaims = (contact: string) =>
  piObservations(contact).filter((observation) => observation.assertsNoValueFor?.includes('email'));

describe('official-profile-pi-backfill attests a page with no address (#5711)', () => {
  it('attests on every identity row when the profile states no address of any kind', () => {
    const observations = piObservations('');
    expect(observations.some((observation) => observation.field === 'email')).toBe(false);
    expect(piClaims('').map((observation) => observation.field)).toEqual(
      expect.arrayContaining(['fname', 'lname']),
    );
    expect(new Set(piClaims('').map((observation) => observation.sourceUrl))).toEqual(
      new Set([PAGE]),
    );
  });

  it('states the address and claims nothing when the profile carries it', () => {
    const contact = '<a href="mailto:rowan.quillfeather@yale.edu">Email</a>';
    expect(
      piObservations(contact).find((observation) => observation.field === 'email')?.value,
    ).toBe('rowan.quillfeather@yale.edu');
    expect(piClaims(contact)).toEqual([]);
  });

  it('claims nothing when the page shows an address its person filter refuses', () => {
    const contact = '<p>Appointments: fixture.scheduling@yale.edu</p>';
    expect(piObservations(contact).some((observation) => observation.field === 'email')).toBe(
      false,
    );
    expect(piClaims(contact)).toEqual([]);
  });

  it('claims nothing when the lane is not reading email in this mode', () => {
    const identity = extractOfficialProfileIdentity(piProfile(''), PAGE, piEntity, {
      requireEmail: false,
      expectedPeople: piEntity.leadUsers,
    });
    const observations = identityToUserObservations(
      identity!,
      { netid: 'rq1' },
      { includeEmail: false },
    );
    expect(
      observations.some((observation) => observation.assertsNoValueFor?.includes('email')),
    ).toBe(false);
  });
});

const rosterProfile = (contact: string) => `<!doctype html>
<html><head><title>Rowan Quillfeather | Fixture Studies</title></head>
<body><main><article><h1>Rowan Quillfeather</h1><div class="person-title">Professor</div>${contact}</article></main>
<footer class="site-footer"><a href="mailto:fixture.office@yale.edu">fixture.office@yale.edu</a></footer></body></html>`;
const ROSTER_PROFILE = 'https://fixture.yale.edu/people/rowan-quillfeather';

describe('dept-faculty-roster records an email slot claim (#5711)', () => {
  it('records empty when the profile states no address outside its chrome', () => {
    expect(profileEnrichmentFromHtml(rosterProfile(''), ROSTER_PROFILE).emailSlotAttestation).toBe(
      'empty',
    );
  });

  it('records nothing when the profile carries any address in its content', () => {
    expect(
      profileEnrichmentFromHtml(
        rosterProfile('<p>Lab manager: fixture.manager@yale.edu</p>'),
        ROSTER_PROFILE,
      ).emailSlotAttestation,
    ).toBeUndefined();
  });

  it('records refused for a roster address it withholds as shared', () => {
    const shared = 'fixture.shared@yale.edu';
    const [first] = withoutSharedRosterEmails([
      { entry: { name: 'Rowan Quillfeather', email: shared } },
      { entry: { name: 'Sable Inkwright', email: shared } },
    ]);
    expect(first.entry).toMatchObject({ email: undefined, emailSlotAttestation: 'refused' });
  });
});
