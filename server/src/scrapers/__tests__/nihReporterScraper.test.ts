/**
 * Unit tests for NihReporterScraper.
 *
 * The pure helpers (`canonicalPiName`, `groupGrantsByPi`, `grantToRecord`,
 * `piGrantsToObservations`) are tested directly. `findUserForPi` is exercised
 * with a hand-built mock User model. The full `run()` is tested by stubbing
 * `axios.post` for the network and passing a mock User model so no DB or
 * real HTTP I/O occurs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import mongoose from 'mongoose';
import {
  NihReporterScraper,
  canonicalPiName,
  pickContactPiName,
  piEntityKey,
  piSlugForResearchGroup,
  groupGrantsByPi,
  isTraineeFellowshipGrant,
  grantToRecord,
  grantAbstractToDescription,
  labDescriptionFromRecentGrants,
  piGrantsToObservations,
  findUserForPi,
  resolveUserForPi,
  type NihGrant,
} from '../sources/nihReporterScraper';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Sample fixtures (shape matches a real NIH RePORTER `results[i]` record)
// ---------------------------------------------------------------------------

const grantArnsten: NihGrant = {
  project_num: '5R01MH123456-03',
  appl_id: 11000001,
  core_project_num: 'R01MH123456',
  project_title: 'Prefrontal cortex circuits in cognitive aging',
  abstract_text: 'We will study PFC circuit dynamics in aging primates.',
  contact_pi_name: 'ARNSTEN, AMY F',
  principal_investigators: [
    {
      profile_id: 1,
      first_name: 'Amy',
      last_name: 'Arnsten',
      full_name: 'Amy F Arnsten',
      is_contact_pi: true,
    },
  ],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'NEUROSCIENCES' },
  fiscal_year: 2025,
  award_amount: 654321,
  project_start_date: '2025-04-01T00:00:00',
  project_end_date: '2030-03-31T00:00:00',
  agency_ic_admin: { code: 'MH', abbreviation: 'NIMH', name: 'NIMH' },
  activity_code: 'R01',
  project_detail_url: 'https://reporter.nih.gov/project-details/11000001',
};

const grantArnsten2: NihGrant = {
  ...grantArnsten,
  project_num: '5R21AG999999-01',
  appl_id: 11000002,
  core_project_num: 'R21AG999999',
  project_title: 'Adrenergic modulation in working memory',
  fiscal_year: 2024,
  award_amount: 230000,
  project_start_date: '2024-08-15T00:00:00',
  project_end_date: '2026-07-31T00:00:00',
  agency_ic_admin: { code: 'AG', abbreviation: 'NIA', name: 'NIA' },
  project_detail_url: 'https://reporter.nih.gov/project-details/11000002',
};

const grantRoster: NihGrant = {
  project_num: '1R35GM222222-01',
  appl_id: 12000001,
  project_title: 'Riboswitch discovery and bacterial gene control',
  abstract_text: '',
  contact_pi_name: 'ROSTER, RILEY R',
  principal_investigators: [
    {
      profile_id: 2,
      first_name: 'Riley',
      last_name: 'Roster',
      is_contact_pi: true,
    },
  ],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'BIOLOGY' },
  fiscal_year: 2025,
  award_amount: 1000000,
  project_start_date: '2025-01-01T00:00:00',
  project_end_date: '2030-12-31T00:00:00',
  agency_ic_admin: { code: 'GM', abbreviation: 'NIGMS', name: 'NIGMS' },
  activity_code: 'R35',
  project_detail_url: 'https://reporter.nih.gov/project-details/12000001',
};

const grantOrphan: NihGrant = {
  project_num: '5F31AI181508-01',
  appl_id: 13000001,
  project_title: 'Trainee fellowship — no contact PI structured',
  contact_pi_name: '',
  principal_investigators: [],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'IMMUNOLOGY' },
  fiscal_year: 2025,
};

// An F31 individual trainee fellowship whose contact PI (the trainee) is fully
// resolvable — it would mint a "<Fellow> Lab" if not failed closed (#739).
const grantTrainee: NihGrant = {
  project_num: '5F31MH333333-02',
  appl_id: 14000001,
  core_project_num: 'F31MH333333',
  project_title: 'Dissertation research on synaptic plasticity',
  abstract_text: 'The candidate will investigate synaptic plasticity mechanisms.',
  contact_pi_name: 'TRAINEE, TAYLOR T',
  principal_investigators: [
    {
      profile_id: 3,
      first_name: 'Taylor',
      last_name: 'Trainee',
      is_contact_pi: true,
    },
  ],
  organization: { org_name: 'YALE UNIVERSITY', dept_type: 'NEUROSCIENCES' },
  fiscal_year: 2025,
  award_amount: 45000,
  project_start_date: '2025-07-01T00:00:00',
  project_end_date: '2027-06-30T00:00:00',
  agency_ic_admin: { code: 'MH', abbreviation: 'NIMH', name: 'NIMH' },
  activity_code: 'F31',
  project_detail_url: 'https://reporter.nih.gov/project-details/14000001',
};

// ---------------------------------------------------------------------------
// canonicalPiName + piEntityKey + piSlugForResearchGroup
// ---------------------------------------------------------------------------

describe('canonicalPiName', () => {
  it('converts "LAST, FIRST MIDDLE" into "First Last"', () => {
    expect(canonicalPiName('ARNSTEN, AMY F')).toBe('Amy Arnsten');
    expect(canonicalPiName('ROSTER, RILEY R')).toBe('Riley Roster');
  });

  it('passes through already-natural-order names with title casing for ALL CAPS', () => {
    expect(canonicalPiName('AMY ARNSTEN')).toBe('Amy Arnsten');
  });

  it('title-cases each run of a hyphenated surname or given name', () => {
    expect(canonicalPiName('OHNO-MACHADO, RILEY')).toBe('Riley Ohno-Machado');
    expect(canonicalPiName('CHEUNG, KEI-HOI')).toBe('Kei-Hoi Cheung');
  });

  it('title-cases each run around an apostrophe', () => {
    expect(canonicalPiName("D'SOUZA, RILEY")).toBe("Riley D'Souza");
  });

  it('leaves already-correctly-cased hyphenated/apostrophized names unchanged', () => {
    expect(canonicalPiName('Ohno-Machado, Riley')).toBe('Riley Ohno-Machado');
    expect(canonicalPiName("D'Souza, Riley")).toBe("Riley D'Souza");
  });

  it('returns empty string on falsy input', () => {
    expect(canonicalPiName('')).toBe('');
    expect(canonicalPiName(null)).toBe('');
    expect(canonicalPiName(undefined)).toBe('');
  });
});

describe('piEntityKey / piSlugForResearchGroup', () => {
  it('produces a deterministic, slug-friendly key per PI', () => {
    expect(piEntityKey('Amy Arnsten')).toBe('nih-pi:amy-arnsten');
    expect(piSlugForResearchGroup('Amy Arnsten')).toBe('nih-pi-amy-arnsten');
  });
  it('returns empty string for empty input', () => {
    expect(piEntityKey('')).toBe('');
    expect(piSlugForResearchGroup('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// pickContactPiName
// ---------------------------------------------------------------------------

describe('pickContactPiName', () => {
  it('prefers the structured is_contact_pi entry over the unstructured string', () => {
    expect(pickContactPiName(grantArnsten)).toBe('Amy Arnsten');
  });

  it('falls back to contact_pi_name when no structured PI is marked contact', () => {
    const grant: NihGrant = {
      ...grantArnsten,
      principal_investigators: [],
      contact_pi_name: 'SMITH, JOHN',
    };
    expect(pickContactPiName(grant)).toBe('John Smith');
  });

  it('returns empty string when nothing identifies a PI', () => {
    expect(pickContactPiName(grantOrphan)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// groupGrantsByPi
// ---------------------------------------------------------------------------

describe('groupGrantsByPi', () => {
  it('groups multiple grants for the same PI under a single canonical key', () => {
    const groups = groupGrantsByPi([grantArnsten, grantArnsten2, grantRoster]);
    expect(groups.size).toBe(2);
    expect(groups.get('Amy Arnsten')).toHaveLength(2);
    expect(groups.get('Riley Roster')).toHaveLength(1);
  });

  it('drops grants with no resolvable contact PI', () => {
    const groups = groupGrantsByPi([grantArnsten, grantOrphan]);
    expect(groups.size).toBe(1);
    expect(groups.has('Amy Arnsten')).toBe(true);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupGrantsByPi([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isTraineeFellowshipGrant (#739)
// ---------------------------------------------------------------------------

describe('isTraineeFellowshipGrant', () => {
  it('flags NIH individual trainee-fellowship activity codes F30/F31/F32/F33', () => {
    for (const code of ['F30', 'F31', 'F32', 'F33']) {
      expect(isTraineeFellowshipGrant({ activity_code: code })).toBe(true);
    }
    expect(isTraineeFellowshipGrant(grantTrainee)).toBe(true);
  });

  it('is case- and whitespace-insensitive on the activity code', () => {
    expect(isTraineeFellowshipGrant({ activity_code: ' f31 ' })).toBe(true);
  });

  it('leaves faculty research awards and other fellowship classes unflagged', () => {
    for (const code of ['R01', 'R35', 'R21', 'K99', 'T32', 'F05', 'P30', undefined]) {
      expect(isTraineeFellowshipGrant({ activity_code: code })).toBe(false);
    }
    expect(isTraineeFellowshipGrant(grantArnsten)).toBe(false);
    expect(isTraineeFellowshipGrant(grantRoster)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// grantToRecord
// ---------------------------------------------------------------------------

describe('grantToRecord', () => {
  it('normalizes the API record to the schema-shaped record', () => {
    const rec = grantToRecord(grantArnsten);
    expect(rec.id).toBe('5R01MH123456-03');
    expect(rec.agency).toBe('NIMH');
    expect(rec.title).toBe('Prefrontal cortex circuits in cognitive aging');
    expect(rec.abstract).toBe('We will study PFC circuit dynamics in aging primates.');
    expect(rec.startDate).toBeInstanceOf(Date);
    expect(rec.startDate?.toISOString().slice(0, 10)).toBe('2025-04-01');
    expect(rec.endDate?.toISOString().slice(0, 10)).toBe('2030-03-31');
    expect(rec.dollarAmount).toBe(654321);
    expect(rec.url).toBe('https://reporter.nih.gov/project-details/11000001');
    expect(rec.role).toBe('pi');
  });

  it('falls back to a stable id and url when project_num/url are missing', () => {
    const grant: NihGrant = {
      appl_id: 99,
      project_title: 'Untitled',
      principal_investigators: [],
      contact_pi_name: 'X, Y',
    };
    const rec = grantToRecord(grant);
    expect(rec.id).toBe('appl-99');
    expect(rec.url).toContain('reporter.nih.gov/project-details/99');
    expect(rec.dollarAmount).toBe(0);
  });

  it('defaults agency to NIH when agency_ic_admin is absent', () => {
    const grant: NihGrant = {
      project_num: 'X',
      project_title: 'Y',
      principal_investigators: [],
      contact_pi_name: 'A, B',
    };
    expect(grantToRecord(grant).agency).toBe('NIH');
  });
});

// ---------------------------------------------------------------------------
// resolveUserForPi / findUserForPi (name matching delegated to the keystone)
// ---------------------------------------------------------------------------

function stubResolver(
  status: 'matched' | 'absent' | 'ambiguous',
  researcherId?: mongoose.Types.ObjectId,
  title?: string,
) {
  return {
    resolveResearcherId: async () => (researcherId ? { status, researcherId } : { status }),
    loadResearcherProfileTitle: async () => title,
  };
}

describe('resolveUserForPi', () => {
  it('delegates identity matching to the researcher resolver', async () => {
    const id = new mongoose.Types.ObjectId();
    expect(await resolveUserForPi('Amy Arnsten', stubResolver('matched', id))).toEqual({
      status: 'matched',
      user: { _id: id.toString(), researchHomeEligible: true },
    });
    expect(await resolveUserForPi('Amy Arnsten', stubResolver('absent'))).toEqual({
      status: 'absent',
    });
    expect(await resolveUserForPi('Amy Arnsten', stubResolver('ambiguous'))).toEqual({
      status: 'ambiguous',
    });
  });

  it('is absent for an empty PI name', async () => {
    expect(
      await resolveUserForPi('', stubResolver('matched', new mongoose.Types.ObjectId())),
    ).toEqual({ status: 'absent' });
  });

  it('gates a postdoctoral / research-affiliate title out of research-home eligibility', async () => {
    const id = new mongoose.Types.ObjectId();
    expect(
      await resolveUserForPi(
        'Robin Hutchison',
        stubResolver('matched', id, 'Postdoctoral Associate in Pharmacology'),
      ),
    ).toEqual({ status: 'matched', user: { _id: id.toString(), researchHomeEligible: false } });
  });

  it('returns the matched researcher via findUserForPi and null otherwise', async () => {
    const id = new mongoose.Types.ObjectId();
    expect(await findUserForPi('Amy Arnsten', stubResolver('matched', id))).toEqual({
      _id: id.toString(),
      researchHomeEligible: true,
    });
    expect(await findUserForPi('Nobody Here', stubResolver('absent'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// piGrantsToObservations
// ---------------------------------------------------------------------------

describe('grantAbstractToDescription', () => {
  it('strips a leading PROJECT SUMMARY/ABSTRACT header and keeps lead prose', () => {
    const out = grantAbstractToDescription(
      'PROJECT SUMMARY/ABSTRACT\nThe lab investigates malaria transmission dynamics in the Amazon. It develops field-deployable diagnostics.',
    );
    expect(out.startsWith('The lab investigates malaria transmission')).toBe(true);
    expect(out).not.toMatch(/project summary/i);
  });

  it('strips numbered, parenthetical, and PROPOSAL/OVERALL header variants', () => {
    expect(grantAbstractToDescription('7. PROJECT SUMMARY/ABSTRACT Stimulant use disorder is a major burden.')).toBe(
      'Stimulant use disorder is a major burden.',
    );
    expect(grantAbstractToDescription('(ABSTRACT) Humoral immunity forms the basis for vaccine protection.')).toBe(
      'Humoral immunity forms the basis for vaccine protection.',
    );
    expect(
      grantAbstractToDescription('Modified Project Summary/Abstract Section Vascular smooth muscle cells adapt to stress.'),
    ).toBe('Vascular smooth muscle cells adapt to stress.');
  });

  it('strips a leading PROGRAM SUMMARY/ABSTRACT header', () => {
    expect(
      grantAbstractToDescription(
        'Program Summary/Abstract In 2020, over 85,000 people died from drug overdoses in the US.',
      ),
    ).toBe('In 2020, over 85,000 people died from drug overdoses in the US.');
  });

  it('returns empty for placeholder or blank abstracts', () => {
    expect(grantAbstractToDescription('No Abstract')).toBe('');
    expect(grantAbstractToDescription('   ')).toBe('');
    expect(grantAbstractToDescription(undefined)).toBe('');
    expect(grantAbstractToDescription('N/A')).toBe('');
  });

  it('bounds output to whole sentences within the character budget', () => {
    const long = `Sentence one is a complete clause about neurons. ${'x'.repeat(500)} tail.`;
    const out = grantAbstractToDescription(long);
    expect(out).toBe('Sentence one is a complete clause about neurons.');
  });

  it('picks the first recent grant that carries a usable abstract', () => {
    expect(
      labDescriptionFromRecentGrants([
        grantToRecord({ ...grantArnsten, abstract_text: 'No Abstract' }),
        grantToRecord({ ...grantArnsten, abstract_text: 'PROJECT SUMMARY The circuit study is underway.' }),
      ]),
    ).toBe('The circuit study is underway.');
  });

  it('drops a leading agency funding-disclaimer sentence before taking the lead prose', () => {
    const out = grantAbstractToDescription(
      'PROJECT SUMMARY This award is funded in whole or in part under the American Rescue Plan Act of 2021. Plant-pathogenic microorganisms are ubiquitous in soils.',
    );
    expect(out).toBe('Plant-pathogenic microorganisms are ubiquitous in soils.');
  });

  it('drops a leading disease-burden significance opener and keeps the lab-specific sentence after it', () => {
    const out = grantAbstractToDescription(
      'Respiratory syncytial virus (RSV) is a significant source of morbidity and mortality in the pediatric population. This project develops a maternal RSV vaccine to prevent severe infection in infants.',
    );
    expect(out).toBe('This project develops a maternal RSV vaccine to prevent severe infection in infants.');
  });

  it('returns empty when the whole abstract is a significance/background opener with nothing else', () => {
    expect(
      grantAbstractToDescription(
        'Adolescents with type 1 diabetes struggle more than any other age group to meet recommended glycemic targets.',
      ),
    ).toBe('');
    expect(
      grantAbstractToDescription('Excessive alcohol intake is the third leading cause of preventable death in the US.'),
    ).toBe('');
    expect(
      grantAbstractToDescription('The United States is at the forefront of the global obesity epidemic.'),
    ).toBe('');
    expect(
      grantAbstractToDescription(
        'Percutaneous coronary intervention (PCI) is the most common cardiac procedure with over 650,000 PCI performed annually in the U.S.',
      ),
    ).toBe('');
    expect(
      grantAbstractToDescription(
        'Major surgery is a common event in the lives of community-living older persons, with a 5-year cumulative incidence of 13.8%.',
      ),
    ).toBe('');
    expect(
      grantAbstractToDescription(
        'Nearly 2 million persons aged 65 years or older are admitted to an intensive care unit each year.',
      ),
    ).toBe('');
  });

  it('drops multiple consecutive significance/background sentences before the research description', () => {
    const out = grantAbstractToDescription(
      'Major surgery is a common event in the lives of community-living older persons. The United States is at the forefront of the global obesity epidemic. This study characterizes recovery trajectories after major abdominal surgery in older adults.',
    );
    expect(out).toBe('This study characterizes recovery trajectories after major abdominal surgery in older adults.');
  });

  it('collapses a PDF line-wrap hyphenation artifact without dropping a genuine hyphenated compound', () => {
    const out = grantAbstractToDescription(
      'This study examines alcohol- associated liver disease with a 5-year cumulative inci- dence of 13.8%.',
    );
    expect(out).toBe('This study examines alcohol-associated liver disease with a 5-year cumulative inci-dence of 13.8%.');
  });
});

describe('labDescriptionFromRecentGrants (non-research grant guard)', () => {
  it('skips a training-grant abstract and falls through to a real research grant', () => {
    const training = grantToRecord({
      ...grantArnsten,
      project_title: 'Training in Investigative Infectious Diseases',
      abstract_text:
        'PROJECT SUMMARY This is a competing renewal of a postdoctoral training program. The program trains fellows across immunology, virology, and bacterial pathogenesis.',
    });
    const research = grantToRecord({
      ...grantArnsten,
      project_title: 'Prefrontal cortex circuits in cognitive aging',
      abstract_text:
        'PROJECT SUMMARY The lab investigates prefrontal cortex circuit dynamics in aging primates.',
    });
    expect(labDescriptionFromRecentGrants([training, research])).toBe(
      'The lab investigates prefrontal cortex circuit dynamics in aging primates.',
    );
  });

  it('skips an NSF GRFP fellowship grant', () => {
    const grfp = grantToRecord({
      ...grantArnsten,
      project_title: 'Graduate Research Fellowship Program (GRFP)',
      abstract_text:
        'The National Science Foundation (NSF) Graduate Research Fellowship Program (GRFP) is a highly competitive, federal fellowship program.',
    });
    expect(labDescriptionFromRecentGrants([grfp])).toBe('');
  });

  it('skips an I-Corps commercialization grant', () => {
    const iCorps = grantToRecord({
      ...grantArnsten,
      project_title: 'I-Corps: Translation potential of segmentation software',
      abstract_text: 'The broader impact of this I-Corps project is the development of a novel analytic software tool.',
    });
    expect(labDescriptionFromRecentGrants([iCorps])).toBe('');
  });

  it('skips a conference / travel grant', () => {
    const travel = grantToRecord({
      ...grantArnsten,
      project_title: 'Travel: NSF Student Travel Grant for 2025 Symposium',
      abstract_text: 'This grant supports student participation in the 4th Symposium on Computer Science and Law.',
    });
    expect(labDescriptionFromRecentGrants([travel])).toBe('');
  });

  it('skips a mentored career-development K-award personal statement', () => {
    const k23 = grantToRecord({
      ...grantArnsten,
      project_title: 'The neural correlates of the effects of psilocybin in OCD',
      abstract_text:
        'This application for a K23 mentored patient-oriented research career development award will provide the applicant, a clinician-scientist, with training.',
    });
    expect(labDescriptionFromRecentGrants([k23])).toBe('');
  });

  it('skips a "Candidate: I aim to build an independent career" personal statement', () => {
    const candidate = grantToRecord({
      ...grantArnsten,
      project_title: 'Adrenergic Nerves in Idiopathic Pulmonary Fibrosis',
      abstract_text:
        'PROJECT SUMMARY Candidate: I aim to build an independent career as an R01-funded physician scientist investigating pulmonary fibrosis.',
    });
    expect(labDescriptionFromRecentGrants([candidate])).toBe('');
  });
});

describe('piGrantsToObservations', () => {
  it('emits user + research-group observations when no Yale user is matched', () => {
    const obs = piGrantsToObservations('Amy Arnsten', [grantArnsten, grantArnsten2], null);

    const userObs = obs.filter((o) => o.entityType === 'user');
    expect(userObs.length).toBeGreaterThan(0);
    expect(userObs.every((o) => o.entityKey === 'nih-pi:amy-arnsten')).toBe(true);
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Amy');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Arnsten');

    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    expect(groupObs.every((o) => o.entityKey === 'nih-pi-amy-arnsten')).toBe(true);
    expect(groupObs.find((o) => o.field === 'slug')?.value).toBe('nih-pi-amy-arnsten');
    expect(groupObs.find((o) => o.field === 'name')?.value).toBe('Amy Arnsten Lab');
    expect(groupObs.find((o) => o.field === 'name')?.confidenceOverride).toBe(0.3);
    expect(groupObs.find((o) => o.field === 'kind')?.value).toBe('lab');
    const fullDescription = groupObs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toBe('We will study PFC circuit dynamics in aging primates.');
    expect(fullDescription?.confidenceOverride).toBe(0.35);
    expect(groupObs.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NIH']);

    const recentGrants = groupObs.find((o) => o.field === 'recentGrants')?.value as any[];
    expect(recentGrants).toHaveLength(2);
    // Sorted descending by start_date — Arnsten1 (2025-04-01) before Arnsten2 (2024-08-15).
    expect(recentGrants[0].id).toBe('5R01MH123456-03');
    expect(recentGrants[1].id).toBe('5R21AG999999-01');

    expect(groupObs.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
    const lastObserved = groupObs.find((o) => o.field === 'lastObservedAt')?.value as Date;
    expect(lastObserved).toBeInstanceOf(Date);
    expect(lastObserved.toISOString().slice(0, 10)).toBe('2025-04-01');

    expect(groupObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('nih-pi:amy-arnsten');
    expect(groupObs.find((o) => o.field === 'inferredPiUserId')).toBeUndefined();
  });

  it('skips the user observation block and emits inferredPiUserId when matched', () => {
    const obs = piGrantsToObservations('Riley Roster', [grantRoster], {
      _id: 'user-abc',
      netid: 'rrb1',
    });
    expect(obs.filter((o) => o.entityType === 'user')).toHaveLength(0);
    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    const piId = groupObs.find((o) => o.field === 'inferredPiUserId');
    expect(piId?.value).toBe('user-abc');
    expect(piId?.confidenceOverride).toBeGreaterThanOrEqual(0.8);
    expect(groupObs.find((o) => o.field === 'inferredPiUserKey')).toBeUndefined();
  });

  it('enriches one canonical research home without overwriting its identity fields', () => {
    const obs = piGrantsToObservations(
      'Riley Roster',
      [grantRoster],
      { _id: 'user-abc', netid: 'rrb1' },
      'dept-mcdb-riley-roster',
    );
    const groupObs = obs.filter((o) => o.entityType === 'researchEntity');
    expect(groupObs.every((o) => o.entityKey === 'dept-mcdb-riley-roster')).toBe(true);
    expect(groupObs.find((o) => o.field === 'slug')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'name')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'kind')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'departments')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'sourceUrls')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(groupObs.find((o) => o.field === 'recentGrants')).toBeDefined();
    expect(groupObs.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NIH']);
  });

  it('emits no research-home observations for known non-owner grant PIs', () => {
    expect(
      piGrantsToObservations('Robin Hutchison', [grantArnsten], {
        _id: 'user-postdoc',
        netid: 'jh1',
        researchHomeEligible: false,
      }),
    ).toEqual([]);
  });

  it('truncates recentGrants to the configured cap', () => {
    const many: NihGrant[] = Array.from({ length: 20 }, (_v, i) => ({
      ...grantArnsten,
      project_num: `R01-${i}`,
      appl_id: 20000000 + i,
      project_start_date: `2024-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00`,
    }));
    const obs = piGrantsToObservations('Amy Arnsten', many, null);
    const recentGrants = obs.find(
      (o) => o.entityType === 'researchEntity' && o.field === 'recentGrants',
    )?.value as any[];
    expect(recentGrants).toHaveLength(10);
    expect(obs.find((o) => o.field === 'recentGrantCount')?.value).toBe(20);
    expect(
      obs.find((o) => o.entityType === 'researchEntity' && o.field === 'recentGrantCount')?.value,
    ).toBe(20);
  });

  it('returns no observations on empty inputs', () => {
    expect(piGrantsToObservations('', [grantArnsten], null)).toEqual([]);
    expect(piGrantsToObservations('Amy Arnsten', [], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full run() with mocked axios + mocked User model
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'nih-reporter',
    sourceWeight: 0.9,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NihReporterScraper.run', () => {
  it('paginates the API, groups by PI, resolves users, and emits observations', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async (_url, body) => {
      const offset = (body as any).offset || 0;
      // Page 1 returns 2 grants for Arnsten + 1 for Roster; page 2 returns empty.
      if (offset === 0) {
        return {
          data: {
            meta: { total: 3, offset: 0, limit: 500 },
            results: [grantArnsten, grantArnsten2, grantRoster],
          },
        } as any;
      }
      return { data: { meta: { total: 3, offset, limit: 500 }, results: [] } } as any;
    });

    // Match Roster but not Arnsten.
    const breakerId = new mongoose.Types.ObjectId();
    const resolveResearcherId = async (name: string) =>
      /roster/i.test(name)
        ? { status: 'matched' as const, researcherId: breakerId }
        : { status: 'absent' as const };

    const researchHomeResolver = vi.fn().mockResolvedValue({ status: 'safe-shell' });
    const scraper = new NihReporterScraper({
      resolveResearcherId,
      loadResearcherProfileTitle: async () => undefined,
      researchHomeResolver,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(postSpy).toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(2); // 2 unique PIs
    expect(result.notes).toContain('matched 1');
    expect(result.notes).toContain('stubbed 1');
    expect(researchHomeResolver).toHaveBeenCalledWith(breakerId.toString());

    // Arnsten unmatched → user obs present
    const arnstenUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:amy-arnsten',
    );
    expect(arnstenUserObs.length).toBeGreaterThan(0);

    // Roster matched → no user obs
    const breakerUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:riley-roster',
    );
    expect(breakerUserObs).toHaveLength(0);

    // Both should have ResearchGroup observations
    const arnstenGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-amy-arnsten',
    );
    expect(arnstenGroup.length).toBeGreaterThan(0);
    expect(arnstenGroup.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);

    const breakerGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-riley-roster',
    );
    expect(breakerGroup.find((o) => o.field === 'inferredPiUserId')?.value).toBe(
      breakerId.toString(),
    );
  });

  it('never mints an entity for an individual trainee-fellowship award (#739)', async () => {
    vi.spyOn(axios, 'post').mockImplementation(async (_url, body) => {
      const offset = (body as any).offset || 0;
      if (offset === 0) {
        return {
          data: {
            meta: { total: 2, offset: 0, limit: 500 },
            results: [grantArnsten, grantTrainee],
          },
        } as any;
      }
      return { data: { meta: { total: 2, offset, limit: 500 }, results: [] } } as any;
    });

    const scraper = new NihReporterScraper({
      resolveResearcherId: async () => ({ status: 'absent' as const }),
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);

    const traineeGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-taylor-trainee',
    );
    expect(traineeGroup).toHaveLength(0);
    const traineeUserObs = emitted.filter(
      (o) => o.entityType === 'user' && o.entityKey === 'nih-pi:taylor-trainee',
    );
    expect(traineeUserObs).toHaveLength(0);

    const arnstenGroup = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey === 'nih-pi-amy-arnsten',
    );
    expect(arnstenGroup.length).toBeGreaterThan(0);
  });

  it('honors the limit option (caps PIs processed, not raw grants)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        meta: { total: 3, offset: 0, limit: 500 },
        results: [grantArnsten, grantArnsten2, grantRoster],
      },
    } as any);
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { meta: { total: 3, offset: 3, limit: 500 }, results: [] },
    } as any);

    const scraper = new NihReporterScraper({
      resolveResearcherId: async () => ({ status: 'absent' as const }),
    });
    const { ctx, emitted } = makeContext({ limit: 1 });
    const result = await scraper.run(ctx);

    // Only one PI should have been emitted observations for.
    const groupKeys = new Set(
      emitted.filter((o) => o.entityType === 'researchEntity').map((o) => o.entityKey),
    );
    expect(groupKeys.size).toBe(1);
    expect(result.entitiesObserved).toBe(1);
  });

  it('rejects unsafe runtime limits before fetching NIH pages', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { meta: { total: 0, offset: 0, limit: 500 }, results: [] },
    } as any);
    const scraper = new NihReporterScraper({
      resolveResearcherId: async () => ({ status: 'absent' as const }),
    });
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(postSpy).not.toHaveBeenCalled();
  });
});
