import { describe, expect, it } from 'vitest';
import {
  CROSS_DOMAIN_AREA_EXEMPT_SLUGS,
  crossDomainAreaCollision,
  crossDomainAreaDomains,
} from '../crossDomainAreaCollisionCore';

describe('crossDomainAreaCollision', () => {
  it('fires on the grafts this issue named, which is what makes a zero meaningful', () => {
    expect(
      crossDomainAreaCollision([
        'Early Medieval Chinese Literature and Art',
        'Hearing Loss and Rehabilitation',
        'Neuroscience and Neuropharmacology Research',
      ]),
    ).toMatchObject({ domains: ['biomedical', 'humanities'] });
    expect(
      crossDomainAreaCollision([
        'FinTech, Crowdfunding, Digital Finance',
        'Gastrointestinal Bleeding Diagnosis and Treatment',
      ]),
    ).toMatchObject({ domains: ['biomedical', 'finance'] });
    expect(
      crossDomainAreaCollision(['Modernist Literature and Criticism', 'Gastric Acid']),
    ).not.toBeNull();
  });

  it('fires on the three rows repaired under this issue', () => {
    expect(
      crossDomainAreaCollision([
        'Literature',
        'Protein Kinase Regulation and GTPase Signaling',
        'Cardiac Ischemia and Reperfusion',
      ]),
    ).not.toBeNull();
    expect(
      crossDomainAreaCollision([
        'Religious Studies',
        'Asian Studies',
        'Dementia and Cognitive Impairment Research',
      ]),
    ).not.toBeNull();
    expect(
      crossDomainAreaCollision([
        'Artificial Intelligence',
        'Neuroscience',
        'Comparative Literature',
      ]),
    ).not.toBeNull();
  });

  it('stays silent on a coherent single-domain chip set', () => {
    expect(
      crossDomainAreaCollision(['Gastric Acid', 'Gastroenterology', 'Electrophysiology']),
    ).toBeNull();
    expect(
      crossDomainAreaCollision(['Lyric poetry and comparative poetics', 'Literature']),
    ).toBeNull();
    expect(crossDomainAreaCollision([])).toBeNull();
  });

  it('does not treat biophysics and medical imaging as a collision', () => {
    expect(
      crossDomainAreaCollision(['Superconductivity and magnetism', 'Cardiac imaging']),
    ).toBeNull();
  });

  it('honours a recorded exemption only for the slug it names', () => {
    const musicPerception = [
      'Musicology and Musical Analysis',
      'Neuroscience and Music Perception',
    ];
    expect(crossDomainAreaCollision(musicPerception)).not.toBeNull();
    expect(crossDomainAreaCollision(musicPerception, 'cohn-rlc35')).toBeNull();
    expect(crossDomainAreaCollision(musicPerception, 'some-other-row')).not.toBeNull();
  });

  it('records a reason for every exemption, so none can hide a real graft silently', () => {
    expect(CROSS_DOMAIN_AREA_EXEMPT_SLUGS.size).toBeGreaterThan(0);
    for (const [slug, reason] of CROSS_DOMAIN_AREA_EXEMPT_SLUGS) {
      expect(slug.trim().length, slug).toBeGreaterThan(0);
      expect(reason.trim().length, `${slug} has no reason`).toBeGreaterThan(20);
    }
  });

  it('ignores a non-string chip rather than throwing on it', () => {
    expect(crossDomainAreaDomains([undefined, 42, 'Literature'])).toEqual(['humanities']);
  });
});
