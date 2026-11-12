import { describe, expect, it } from 'vitest';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';
import {
  USER_ORCID_FIELD_RETRACTION_ROLLBACK_REASON,
  planUserFieldRetractions,
  userFieldRetractionContractFor,
  type UserFieldRetractionCandidateObservation,
  type UserPageRead,
} from '../fieldRetraction';
import { profileEnrichmentFromHtml, rosterAbsenceClaims } from '../sources/departmentRosterScraper';

const SOURCE = 'dept-faculty-roster';
const KEY = 'dept:fixture:rowan-quillfeather';
const PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const YEAR_RUN = '2025-2024-2023-2022';
const contract = userFieldRetractionContractFor(SOURCE)!;
const at = (day: number) => new Date(Date.UTC(2026, 10, day));

const orcidRow = (): UserFieldRetractionCandidateObservation => ({
  observationId: 'obs-orcid',
  entityKey: KEY,
  field: 'orcid',
  value: YEAR_RUN,
  scrapeRunId: 'run-11',
  observedAt: at(11),
  sourceUrl: PAGE,
});

const read = (runDay: number, claims: string[] = []): UserPageRead => ({
  entityKey: KEY,
  sourceUrl: PAGE,
  scrapeRunId: `run-${runDay}`,
  observedAt: at(runDay),
  assertsNoValueFor: claims,
});

describe('dept-faculty-roster may retract an ORCID its own page no longer states (#5991)', () => {
  it('declares orcid beside email for the roster lane only', () => {
    expect(contract.retractableFields).toEqual(['email', 'orcid']);
    expect(
      userFieldRetractionContractFor('official-profile-pi-backfill')?.retractableFields,
    ).toEqual(['email']);
    expect(USER_ORCID_FIELD_RETRACTION_ROLLBACK_REASON).toMatch(/ORCID/);
  });

  it('retracts the stored ORCID once two later reads of that page attest it states none', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(11), read(13, ['orcid']), read(14, ['orcid'])],
      activeObservations: [orcidRow()],
    });
    expect(plan.retractions).toEqual([
      { entityKey: KEY, sourceUrl: PAGE, field: 'orcid', observationIds: ['obs-orcid'] },
    ]);
  });

  it('never retracts the ORCID on an email-only claim', () => {
    const plan = planUserFieldRetractions({
      sourceName: SOURCE,
      contract,
      reads: [read(11), read(13, ['email']), read(14, ['email'])],
      activeObservations: [orcidRow()],
    });
    expect(plan.retractions).toEqual([]);
    expect(plan.counts.absenceNotWitnessed).toBe(1);
  });
});

const rosterProfile = (section: string) => `<!doctype html>
<html><head><title>Rowan Quillfeather | Fixture Studies</title></head>
<body><main><article><h1>Rowan Quillfeather</h1><div class="person-title">Professor</div>${section}</article></main></body></html>`;
const ROSTER_PROFILE = 'https://fixture.yale.edu/people/rowan-quillfeather';
const enrich = (section: string) =>
  profileEnrichmentFromHtml(rosterProfile(section), ROSTER_PROFILE);

describe('dept-faculty-roster records an ORCID slot claim (#5991)', () => {
  it('records empty when the subject node states no ORCID, even beside a year run', () => {
    const enrichment = enrich(`<div class="pub-years"><span>${YEAR_RUN}</span></div>`);
    expect(enrichment.orcid).toBeUndefined();
    expect(enrichment.orcidSlotAttestation).toBe('empty');
  });

  it('records nothing when the page states a plausible ORCID', () => {
    const orcid = syntheticPersonOrcid(301);
    const enrichment = enrich(`<a href="https://orcid.org/${orcid}">ORCID</a>`);
    expect(enrichment.orcid).toBe(orcid);
    expect(enrichment.orcidSlotAttestation).toBeUndefined();
  });

  it('records nothing when the page labels an ORCID the reader refuses', () => {
    const enrichment = enrich(`<p>ORCID: ${YEAR_RUN}</p>`);
    expect(enrichment.orcid).toBeUndefined();
    expect(enrichment.orcidSlotAttestation).toBeUndefined();
  });

  it('claims orcid absent only for a read profile', () => {
    const base = { name: 'Rowan Quillfeather', orcidSlotAttestation: 'empty' as const };
    expect(rosterAbsenceClaims({ ...base, profileReadOutcome: 'read' })).toEqual(['orcid']);
    expect(rosterAbsenceClaims({ ...base, profileReadOutcome: 'unread' })).toEqual([]);
    expect(
      rosterAbsenceClaims({
        ...base,
        profileReadOutcome: 'read',
        orcid: syntheticPersonOrcid(302),
      }),
    ).toEqual([]);
  });
});
