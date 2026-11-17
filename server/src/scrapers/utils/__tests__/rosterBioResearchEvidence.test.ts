import { describe, expect, it } from 'vitest';
import {
  ROSTER_BIO_EVIDENCE_FIELD,
  planRosterBioResearchRows,
  rosterBioMintRefusal,
  rosterBioPersonKey,
  rosterBioPersonName,
  rosterBioRereadObservation,
  rosterBioRereadObservations,
  rosterBioResearchObservations,
  rosterBioTitleVerdict,
  type RosterBioCoveredIdentities,
  type RosterBioPerson,
} from '../rosterBioResearchEvidence';
import { deriveBioResearchStatement } from '../../../utils/bioResearchStatement';
import { rosterBioDepartmentResolver } from '../../sources/rosterBioResearchEvidenceScraper';
import type { DeptConfig } from '../../sources/departmentRosterScraper';

const emptyCovered = (): RosterBioCoveredIdentities => ({
  urls: new Set(),
  personKeys: new Set(),
  personNames: new Set(),
  slugs: new Set(),
});

const resolver = (person: RosterBioPerson, name: string) => ({
  deptName: 'Synthetic Studies',
  schoolName: 'Synthetic School',
  slug: `dept-synthetic-${name.toLowerCase().replace(/\s+/g, '-')}`,
});

const person = (overrides: Partial<RosterBioPerson> = {}): RosterBioPerson => ({
  key: 'dept:synthetic:alex-example',
  fname: 'Alex',
  lname: 'Example',
  title: 'Associate Professor of Synthetic Studies',
  profileUrls: { departmental: 'https://synthetic.yale.edu/profile/alex-example' },
  bio: 'Alex Example received a PhD from Example University. Her research focuses on how synthetic proteins fold in cold environments, combining structural biology, biochemistry, and computational modeling. She studies how chaperone networks recognise misfolded synthetic proteins in polar marine organisms.',
  ...overrides,
});

describe('roster biography research evidence', () => {
  it('mints a faculty-research row whose evidence is the bio research sentence, not a served description', () => {
    const { planned } = planRosterBioResearchRows([person()], emptyCovered(), resolver);
    expect(planned).toHaveLength(1);
    const observations = rosterBioResearchObservations(planned[0]);
    const fields = observations.map((obs) => obs.field);
    expect(fields).not.toContain('fullDescription');
    expect(fields).not.toContain('shortDescription');
    const evidence = observations.find((obs) => obs.field === ROSTER_BIO_EVIDENCE_FIELD);
    expect(evidence?.value).toContain('synthetic proteins fold');
    expect(evidence?.value).not.toContain('received a PhD');
    expect(observations.find((obs) => obs.field === 'name')?.value).toBe(
      'Alex Example Faculty Research',
    );
    expect(observations.find((obs) => obs.field === 'entityType')?.value).toBe(
      'FACULTY_RESEARCH_AREA',
    );
  });

  it('never mints for a person the corpus already covers by profile URL, person key, or name', () => {
    const byUrl = emptyCovered();
    (byUrl.urls as Set<string>).add('synthetic.yale.edu/profile/alex-example');
    const byName = emptyCovered();
    (byName.personNames as Set<string>).add('alex example');
    const byKey = emptyCovered();
    (byKey.personKeys as Set<string>).add('dept:synthetic:alex-example');
    for (const covered of [byUrl, byName, byKey]) {
      expect(planRosterBioResearchRows([person()], covered, resolver).planned).toHaveLength(0);
    }
  });

  it('refuses ranks that cannot host a student and keeps research-track ranks', () => {
    for (const title of [
      'Postdoctoral Associate',
      'Clinical Fellow',
      'Staff Affiliate - Hospital',
      'Postgraduate Associate',
      'Research Associate 2',
      'Visiting Scholar',
      'PhD Student',
    ]) {
      expect(rosterBioTitleVerdict(title)).toBe('non_hosting');
    }
    expect(rosterBioTitleVerdict('Senior Lecturer in Synthetic Studies')).toBe('eligible');
    expect(rosterBioTitleVerdict('Lector, Synthetic Languages and Literatures')).not.toBe(
      'non_hosting',
    );
    expect(rosterBioTitleVerdict('Associate Research Scientist')).toBe('eligible');
    expect(rosterBioTitleVerdict('Associate Research Scholar')).toBe('eligible');
    expect(rosterBioTitleVerdict('Professor of Synthetic Studies')).toBe('eligible');
    expect(rosterBioTitleVerdict('Research Assistant Professor')).toBe('eligible');
    expect(rosterBioTitleVerdict('Research Associate Professor of Synthetic Studies')).toBe(
      'eligible',
    );
  });

  it('refuses clinical service written as a research focus and past research', () => {
    expect(
      deriveBioResearchStatement(
        'Her practice focuses on the surgical treatment of patients with synthetic tumors.',
      ).rejection,
    ).toBeDefined();
    expect(
      deriveBioResearchStatement(
        'Dr. Example specializes in the treatment of degenerative synthetic spine disease, with a particular focus on pain relief.',
      ).rejection,
    ).toBeDefined();
    expect(
      deriveBioResearchStatement(
        'Dr. Example specializes in all aspects of synthetic urology, with a special interest in minimally invasive surgery.',
      ).rejection,
    ).toBeDefined();
    expect(
      deriveBioResearchStatement(
        'Dr. Example is a music theorist specializing in the analysis of synthetic twentieth-century music and the history of music theory, and studies how listeners perceive synthetic harmony.',
      ).rejection,
    ).toBeUndefined();
    expect(
      deriveBioResearchStatement(
        'For over twenty years she directed a synthetic monitoring program for the state.',
      ).rejection,
    ).toBeDefined();
  });

  const RESEARCH_ANCHOR =
    'Her research focuses on how synthetic proteins fold in cold environments.';
  const keptBesideAnchor = (sentence: string) =>
    deriveBioResearchStatement(`${RESEARCH_ANCHOR} ${sentence}`).evidenceSentences.includes(
      sentence,
    );

  it('drops a clinical-service sentence that states no research (#6083)', () => {
    for (const sentence of [
      'They have a special interest in synthetic glimmer fever and the care of children with it.',
      'Their clinical interests include synthetic quill rash and related skin conditions.',
      'Their work focuses on supporting patients after synthetic hip repair.',
      'Their work focuses on providing synthetic sleep clinic care to adults across the state.',
      'Their interests focus on ways to provide gentle care to adults with synthetic heart fatigue.',
      'Their work focuses on ways to help patients with synthetic marsh fever rest at home.',
      'They focus on caring for women with synthetic high-risk pregnancies.',
      'Their interests include advancing synthetic eye care across rural towns.',
      'Their work focuses on serving their patients at three synthetic county clinics.',
      'Their work focuses on treating the symptoms of synthetic winter cough in adults.',
      'Their work focuses on care for patients with synthetic marsh fever.',
      'Their clinical interests include synthetic quill rash and cardiac devices.',
      'Their clinical interests include the early detection and treatment of synthetic glimmer fever.',
      'They have a special interest in the early detection of synthetic skin cancer.',
      'Their work focuses on providing gentle care to patients with implanted cardiac devices.',
      'Their interests focus on building trusting bonds with patients and providing gentle care.',
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(false);
    }
  });

  it('refuses a biography whose only research-shaped sentences are clinical service (#6083)', () => {
    expect(
      deriveBioResearchStatement(
        'Their work focuses on supporting patients after synthetic hip repair.',
      ).rejection,
    ).toBe('only_past_research');
  });

  it('keeps a clinical research sentence that names patients or care (#6083)', () => {
    for (const sentence of [
      'Their work focuses on the genetics of synthetic glimmer fever in children and adult patients.',
      'Their work focuses on reducing disparities in care for patients with synthetic kidney fatigue.',
      'Their work focuses on improving quality of care for older adults with synthetic memory loss.',
      'They develop wearable sensors to monitor patients with synthetic tremor at home.',
      'Their work focuses on the immunology of synthetic sepsis in critically ill patients.',
      'Their interests include the pathogenesis of synthetic infections in transplant patients.',
      'They study how patients with synthetic joint pain choose among treatments.',
      'Their research follows how their patients with synthetic tremor respond to new devices.',
      'Their work focuses on tracking synthetic blood pressure trajectories in their patients.',
      'Their work focuses on sensors that help their patients with synthetic tremor walk.',
      'Their work focuses on developing new sensors that help their patients walk.',
      'Their work focuses on getting patients back on their feet with a brace they engineer.',
      'Their work focuses on getting patients back on their feet with braces they benchmark.',
      'Their work focuses on getting patients back on their feet with a robotic brace.',
      'They develop machine learning methods that read the scans of their patients for synthetic stroke signs.',
      'They explore why treating the symptoms of synthetic winter cough often fails in teenagers.',
      'Their work focuses on tools that help clinicians help their patients quit synthetic smoking.',
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(true);
    }
  });

  it('drops a first-person sentence about research done in the past (#6083)', () => {
    expect(keptBesideAnchor('We investigated synthetic soil fungi in cold forests.')).toBe(false);
  });

  it('keeps a creative-practice sentence that carries a clinical-service shape (#6083)', () => {
    for (const sentence of [
      'Their special interest is in music written for patients in hospice care.',
      'Their work focuses on writing plays about caregivers and patients in hospitals.',
      'They develop new choreography that engages themes of care and illness.',
      'Their work focuses on caring for patients through portraits made at the bedside.',
      'Their work focuses on caring for patients through a documentary about the ward.',
      'Their work focuses on caring for patients through lullabies sung on night wards.',
      'Their work focuses on caring for patients through murals in clinic halls.',
      'Their work focuses on caring for patients through a memoir of a year on the ward.',
      'Their work focuses on caring for patients through essays about recovery.',
      'Their work focuses on caring for patients through textiles woven with families.',
      'Their work focuses on caring for patients through installations in waiting rooms.',
      'Their work focuses on caring for patients through comedy performed on the ward.',
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(true);
    }
  });

  describe('re-reading the rows the lane minted (#6107)', () => {
    const OWN_SLUG = 'dept-synthetic-alex-example';
    const ownCoverage = (): RosterBioCoveredIdentities => ({
      ...emptyCovered(),
      personKeys: new Set(['dept:synthetic:alex-example']),
      slugs: new Set([OWN_SLUG]),
      ownRowSlugsByPersonKey: new Map([['dept:synthetic:alex-example', OWN_SLUG]]),
    });

    it('re-reads its own row instead of skipping it as covered, and mints nothing new', () => {
      const { planned, reread, skipped } = planRosterBioResearchRows(
        [person()],
        ownCoverage(),
        resolver,
      );
      expect(planned).toEqual([]);
      expect(skipped.already_covered).toBeUndefined();
      expect(reread).toHaveLength(1);
      const observation = rosterBioRereadObservation(reread[0]);
      expect(observation).toMatchObject({ entityKey: OWN_SLUG, field: ROSTER_BIO_EVIDENCE_FIELD });
      expect(observation.value).toContain('synthetic proteins fold');
      expect(observation.assertsNoValueFor).toBeUndefined();
    });

    it('asserts no value on its own row when the biography no longer states research', () => {
      const clinicalOnly = person({
        bio: 'Their work focuses on supporting patients after synthetic hip repair.',
      });
      const { reread } = planRosterBioResearchRows([clinicalOnly], ownCoverage(), resolver);
      expect(reread).toHaveLength(1);
      expect(rosterBioRereadObservation(reread[0])).toMatchObject({
        entityKey: OWN_SLUG,
        field: ROSTER_BIO_EVIDENCE_FIELD,
        value: '',
        assertsNoValueFor: [ROSTER_BIO_EVIDENCE_FIELD],
      });
    });

    it('still skips a person another lane covers', () => {
      const covered = { ...emptyCovered(), personKeys: new Set(['dept:synthetic:alex-example']) };
      const { planned, reread, skipped } = planRosterBioResearchRows([person()], covered, resolver);
      expect(planned).toEqual([]);
      expect(reread).toEqual([]);
      expect(skipped.already_covered).toBe(1);
    });
  });

  it('reads the given name from the profile URL when the roster put a credential there', () => {
    expect(
      rosterBioPersonName(
        person({
          fname: 'Ph.D.',
          lname: 'Example',
          profileUrls: { departmental: 'https://synthetic.yale.edu/profile/alex-example/' },
        }),
      ),
    ).toBe('Alex Example');
    expect(rosterBioPersonName(person({ lname: 'Example, DVM' }))).toBe('Alex Example');
  });

  it('drops a trailing credential the roster split into the surname field', () => {
    expect(rosterBioPersonName(person({ fname: 'Alex Example', lname: 'DVM' }))).toBe(
      'Alex Example',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex', lname: 'Ma' }))).toBe('Alex Ma');
    expect(rosterBioPersonName(person({ fname: 'Alex Example, MD, MPH,', lname: 'Facep' }))).toBe(
      'Alex Example',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex Example, MD,', lname: 'Fawm' }))).toBe(
      'Alex Example',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex Example, MD,', lname: 'Faium' }))).toBe(
      'Alex Example',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex, MD,', lname: 'Example' }))).toBe(
      'Alex Example',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex J., MD,', lname: 'Smith' }))).toBe(
      'Alex J. Smith',
    );
    expect(rosterBioPersonName(person({ fname: 'Mary Ann, MD,', lname: 'Lee' }))).toBe(
      'Mary Ann Lee',
    );
    expect(rosterBioPersonName(person({ fname: 'Alex Example', lname: 'Ma' }))).toBe(
      'Alex Example Ma',
    );
  });

  it('keys a roster person on the slug the roster lane keyed them under, not the display name', () => {
    const config = {
      deptKey: 'synthetic',
      deptName: 'Synthetic Studies',
      schoolName: 'Synthetic School',
      url: 'https://synthetic.yale.edu/people',
    } as DeptConfig;
    const resolve = rosterBioDepartmentResolver([config]);
    const keyed = person({
      key: 'dept:synthetic:alex-q-example',
      departments: ['Synthetic Studies'],
    });
    expect(resolve(keyed, 'Alex Example')?.slug).toBe('dept-synthetic-alex-q-example');
    const netidKeyed = person({ key: 'netid:abc123', departments: ['Synthetic Studies'] });
    expect(resolve(netidKeyed, 'Alex Example')?.slug).toBe('dept-synthetic-alex-example');
  });
});

describe('a credential the roster put where the given name belongs (#6372)', () => {
  const CREDENTIAL_KEY = 'dept:synthetic:phd-example';
  const credentialLed = (overrides: Partial<RosterBioPerson> = {}) =>
    person({
      key: CREDENTIAL_KEY,
      fname: 'PhD',
      lname: 'Example',
      profileUrls: { departmental: 'https://synthetic.yale.edu/profile/alex-example' },
      ...overrides,
    });

  it('rebuilds the person key from the recovered name and mints under it', () => {
    expect(rosterBioPersonKey(credentialLed())).toBe('dept:synthetic:alex-example');
    expect(rosterBioPersonKey(credentialLed({ fname: 'Ph.D.' }))).toBe(
      'dept:synthetic:alex-example',
    );
    const { planned } = planRosterBioResearchRows([credentialLed()], emptyCovered(), resolver);
    expect(planned).toHaveLength(1);
    expect(
      rosterBioResearchObservations(planned[0]).find((obs) => obs.field === 'inferredPiUserKey')
        ?.value,
    ).toBe('dept:synthetic:alex-example');
  });

  it('mints at the slug the roster lane would mint for the rebuilt key', () => {
    const config = {
      deptKey: 'synthetic',
      deptName: 'Synthetic Studies',
      schoolName: 'Synthetic School',
      url: 'https://synthetic.yale.edu/people',
    } as DeptConfig;
    const { planned } = planRosterBioResearchRows(
      [credentialLed({ departments: ['Synthetic Studies'] })],
      emptyCovered(),
      rosterBioDepartmentResolver([config]),
    );
    expect(planned.map((row) => row.slug)).toEqual(['dept-synthetic-alex-example']);
  });

  it('mints nothing when no given name can be recovered', () => {
    const nameless = credentialLed({
      profileUrls: { departmental: 'https://synthetic.yale.edu/profile/12345' },
    });
    expect(rosterBioPersonKey(nameless)).toBe('');
    const { planned, skipped } = planRosterBioResearchRows([nameless], emptyCovered(), resolver);
    expect(planned).toEqual([]);
    expect(skipped.credential_only_given_name).toBe(1);
  });

  it('keeps the key of a real name that is spelled like or starts with a credential', () => {
    for (const [key, fname] of [
      ['dept:synthetic:ma-example', 'Ma'],
      ['dept:synthetic:phdung-example', 'Phdung'],
      ['dept:synthetic:mdala-example', 'Mdala'],
      ['dept:synthetic:alex-example', 'Alex'],
      ['dept:synthetic:dr-alex-example', 'Dr. Alex'],
      ['dept:synthetic:md-alex-example', 'Md Alex'],
      ['dept:synthetic:md-example', 'Md'],
    ]) {
      expect(rosterBioPersonKey(person({ key, fname }))).toBe(key);
    }
    expect(rosterBioPersonKey(credentialLed({ key: 'netid:abc123' }))).toBe('netid:abc123');
  });

  it('re-points its own row to the rebuilt key, and keeps re-reading it once re-pointed', () => {
    const OWN_SLUG = 'dept-synthetic-alex-example';
    const underOldKey: RosterBioCoveredIdentities = {
      ...emptyCovered(),
      personKeys: new Set([CREDENTIAL_KEY]),
      slugs: new Set([OWN_SLUG]),
      ownRowSlugsByPersonKey: new Map([[CREDENTIAL_KEY, OWN_SLUG]]),
    };
    const first = planRosterBioResearchRows([credentialLed()], underOldKey, resolver);
    expect(first.planned).toEqual([]);
    expect(first.reread).toHaveLength(1);
    const observations = rosterBioRereadObservations(first.reread[0]);
    expect(observations.map((obs) => obs.field)).toEqual([
      ROSTER_BIO_EVIDENCE_FIELD,
      'inferredPiUserKey',
    ]);
    expect(observations[1]).toMatchObject({
      entityKey: OWN_SLUG,
      value: 'dept:synthetic:alex-example',
    });
    expect(observations[1].assertsNoValueFor).toBeUndefined();

    const underNewKey: RosterBioCoveredIdentities = {
      ...underOldKey,
      personKeys: new Set(['dept:synthetic:alex-example']),
      ownRowSlugsByPersonKey: new Map([['dept:synthetic:alex-example', OWN_SLUG]]),
    };
    const second = planRosterBioResearchRows([credentialLed()], underNewKey, resolver);
    expect(second.planned).toEqual([]);
    expect(second.reread.map((row) => row.slug)).toEqual([OWN_SLUG]);
  });

  it('adds no lead observation when re-reading a row whose key needed no rebuild', () => {
    const OWN_SLUG = 'dept-synthetic-alex-example';
    const covered: RosterBioCoveredIdentities = {
      ...emptyCovered(),
      personKeys: new Set(['dept:synthetic:alex-example']),
      slugs: new Set([OWN_SLUG]),
      ownRowSlugsByPersonKey: new Map([['dept:synthetic:alex-example', OWN_SLUG]]),
    };
    const { reread } = planRosterBioResearchRows([person()], covered, resolver);
    expect(rosterBioRereadObservations(reread[0]).map((obs) => obs.field)).toEqual([
      ROSTER_BIO_EVIDENCE_FIELD,
    ]);
  });
});

describe('a bio that states no research subject mints nothing (#4954)', () => {
  const plan = (bio: string) =>
    planRosterBioResearchRows([person({ bio })], emptyCovered(), resolver);

  it('refuses a bio that states only clinical care, consultation, or supervision', () => {
    const { planned, skipped } = plan(
      'Alex Example focuses on integrative care and provides clinical consultation to pediatric practices. She supervised student trainees at an outpatient clinic.',
    );
    expect(planned).toHaveLength(0);
    expect(skipped.clinical_teaching_or_consultation_only).toBe(1);
  });

  it('refuses a bio that states only curriculum design for teaching', () => {
    const { planned, skipped } = plan(
      'Alex Example focuses on designing curricula for ultrasound use in clinical science teaching to medical students.',
    );
    expect(planned).toHaveLength(0);
    expect(skipped.clinical_teaching_or_consultation_only).toBe(1);
  });

  it('does not read a Study Center in an affiliation as a stated study', () => {
    const { planned } = plan(
      'Alex Example focuses on integrative care and provides clinical consultation at the Synthetic Child Study Center.',
    );
    expect(planned).toHaveLength(0);
  });

  it('refuses research stated with no topic', () => {
    expect(
      rosterBioMintRefusal(
        [
          'Dr. Example is actively involved in both clinical and basic science research.',
          'Her research and that of her collaborators have been presented at regional, national, and international conferences.',
        ],
        'Alex Example',
      ),
    ).toBe('no_stated_research_topic');
  });

  it('keeps clinical-trials research that has a clinical framing', () => {
    expect(
      rosterBioMintRefusal(
        [
          'She is a clinical investigator whose research focuses on clinical trials of targeted therapies for pediatric leukemia.',
        ],
        'Alex Example',
      ),
    ).toBeUndefined();
  });

  it('keeps a stated research subject that names a clinical word without a research verb', () => {
    for (const sentence of [
      'Her work focuses on the genetics of epilepsy and its treatment.',
      'His interests include the molecular mechanisms of drug resistance in patients with leukemia.',
      'She specializes in the neurobiology of addiction and its therapy.',
      'Her scholarship addresses health disparities in maternal care.',
      'He develops novel imaging methods for cancer therapy.',
      'She is interested in how neonatal encephalopathy alters early brain development.',
    ]) {
      expect(rosterBioMintRefusal([sentence], 'Alex Example')).toBeUndefined();
    }
  });

  it('refuses only when every sentence is clinical or teaching practice', () => {
    expect(
      rosterBioMintRefusal(
        [
          'She provides clinical consultation to pediatric practices.',
          'Her interests include the genetics of childhood epilepsy.',
        ],
        'Alex Example',
      ),
    ).toBeUndefined();
    expect(
      rosterBioMintRefusal(
        [
          'Her professional interests include behavioral medicine and interdisciplinary care.',
          'She supervised student trainees and interns at an outpatient clinic.',
        ],
        'Alex Example',
      ),
    ).toBe('clinical_teaching_or_consultation_only');
  });

  it('keeps a sentence that states a research interest after its clinical-practice clause', () => {
    expect(
      rosterBioMintRefusal(
        [
          'In her clinical practice she cares for children with epilepsy, and she is interested in the genetics of seizure disorders.',
        ],
        'Alex Example',
      ),
    ).toBeUndefined();
    expect(
      rosterBioMintRefusal(
        [
          'She is interested in mindfulness as a therapeutic modality in her clinical work.',
          'Her professional interests include behavioral medicine and interdisciplinary care.',
        ],
        'Alex Example',
      ),
    ).toBe('clinical_teaching_or_consultation_only');
  });

  it('leaves quality-improvement and program work for the owner to decide', () => {
    const { planned } = plan(
      'Alex Example focuses on improving the quality of care for patients with heart failure through care pathway redesign.',
    );
    expect(planned).toHaveLength(1);
  });

  it('keeps research with a topic', () => {
    expect(plan(person().bio as string).planned).toHaveLength(1);
  });
});
