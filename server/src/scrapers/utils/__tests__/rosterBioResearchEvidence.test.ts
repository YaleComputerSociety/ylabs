import { describe, expect, it } from 'vitest';
import {
  ROSTER_BIO_EVIDENCE_FIELD,
  planRosterBioResearchRows,
  rosterBioPersonName,
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
      'Their work focuses on advancing synthetic heart care and supporting patients after discharge.',
      'They offer patients prompt access to synthetic sleep clinic care close to home.',
      'They focus on caring for women with synthetic high-risk pregnancies.',
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(false);
    }
  });

  it('refuses a biography whose only research-shaped sentences are clinical service (#6083)', () => {
    expect(
      deriveBioResearchStatement(
        'Their work focuses on advancing synthetic heart care and supporting patients after discharge.',
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
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(true);
    }
  });

  it('keeps a creative-practice sentence about care or patients (#6083)', () => {
    for (const sentence of [
      'Their special interest is in music written for patients in hospice care.',
      'Their work focuses on writing plays about caregivers and patients in hospitals.',
      'They develop new choreography that engages themes of care and illness.',
    ]) {
      expect(keptBesideAnchor(sentence)).toBe(true);
    }
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
