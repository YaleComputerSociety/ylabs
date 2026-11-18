import { describe, expect, it } from 'vitest';

import {
  extractOfficialProfileIdentity,
  identityToResearchEntitySchoolObservations,
  type OfficialProfileIdentity,
  type SchoolForDepartment,
} from '../sources/officialProfilePiBackfillScraper';
import { LATEST_WINS_FINGERPRINT_FIELDS_BY_SOURCE } from '../observationStore';

const YSPH_PROFILE_URL = 'https://ysph.yale.edu/profile/rowan-fixture/';
const MEDICINE_PROFILE_URL = 'https://medicine.yale.edu/profile/rowan-fixture/';
const ENTITY = {
  _id: '64b7f0c2a1b2c3d4e5f60718',
  name: 'Rowan Fixture Research Area',
  slug: 'faculty-research-area-rowan-fixture',
};

const SCHOOL_BY_DEPARTMENT: Record<string, string> = {
  biostatistics: 'School of Public Health',
  'chronic disease epidemiology': 'School of Public Health',
  'internal medicine': 'School of Medicine',
};
const schoolForDepartment: SchoolForDepartment = (department) =>
  SCHOOL_BY_DEPARTMENT[department.toLowerCase()];

function appointmentCard(unit: string, title: string, type: string): string {
  return `
    <li class="content-layout-column-list-item">
      <article class="card card--color-mode--white profile-details-appointment-card" aria-label="${title} ${type} in ${unit}">
        <h4 class="profile-details-appointment-card__academic-unit">${unit}</h4>
        <div class="profile-details-appointment-card__title">${title}</div>
        <div class="profile-details-appointment-card__type">${type}</div>
        <div class="profile-details-appointment-card__link"><a href="https://ysph.yale.edu/research/"><span class="link__label">${unit}</span></a></div>
      </article>
    </li>`;
}

function ysphProfileHtml(cards: string, canonicalUrl = YSPH_PROFILE_URL): string {
  return `
    <html>
      <head><link rel="canonical" href="${canonicalUrl}" /></head>
      <body>
        <main>
          <h1>Rowan Fixture</h1>
          <div class="title">Associate Professor of Biostatistics</div>
          <a href="mailto:rowan.fixture@yale.edu">rowan.fixture@yale.edu</a>
          <section class="profile-details-content-section" aria-label="about Appointments" id="about-appointments">
            <h3 class="profile-details-content-section__heading">Appointments</h3>
            <div class="profile-details-content-section__content">
              <ul class="content-layout-column-list">${cards}</ul>
            </div>
          </section>
          <section class="biography">Rowan Fixture develops statistical methods for longitudinal cohort studies.</section>
        </main>
      </body>
    </html>`;
}

function identityWith(
  primaryAppointmentUnits: string[] | undefined,
  canonicalUrl = YSPH_PROFILE_URL,
): OfficialProfileIdentity {
  return {
    canonicalUrl,
    fetchedUrl: canonicalUrl,
    displayName: 'Rowan Fixture',
    email: 'rowan.fixture@yale.edu',
    title: 'Associate Professor of Biostatistics',
    departments: primaryAppointmentUnits ?? [],
    researchInterests: [],
    ...(primaryAppointmentUnits ? { primaryAppointmentUnits } : {}),
  };
}

describe('a YSPH research row states the school of its Primary appointment (#6252)', () => {
  it('reads only Primary cards from a stored-capture-shaped profile', () => {
    const identity = extractOfficialProfileIdentity(
      ysphProfileHtml(
        appointmentCard('Biostatistics', 'Associate Professor on Term', 'Primary') +
          appointmentCard('Internal Medicine', 'Associate Professor', 'Secondary'),
      ),
      YSPH_PROFILE_URL,
      ENTITY,
    );

    expect(identity?.primaryAppointmentUnits).toEqual(['Biostatistics']);
  });

  it('records no Primary units for a profile with no appointment cards', () => {
    const identity = extractOfficialProfileIdentity(ysphProfileHtml(''), YSPH_PROFILE_URL, ENTITY);

    expect(identity?.primaryAppointmentUnits).toBeUndefined();
  });

  it('emits the one catalog school its Primary units name, cited to the profile', () => {
    expect(
      identityToResearchEntitySchoolObservations(
        identityWith(['Biostatistics', 'Chronic Disease Epidemiology']),
        ENTITY,
        schoolForDepartment,
      ),
    ).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: ENTITY._id,
        entityKey: ENTITY.slug,
        field: 'school',
        value: 'School of Public Health',
        sourceUrl: YSPH_PROFILE_URL,
      }),
    ]);
  });

  it('emits nothing when the Primary units span two schools', () => {
    expect(
      identityToResearchEntitySchoolObservations(
        identityWith(['Biostatistics', 'Internal Medicine']),
        ENTITY,
        schoolForDepartment,
      ),
    ).toEqual([]);
  });

  it('emits nothing for a Primary unit the catalog does not name', () => {
    expect(
      identityToResearchEntitySchoolObservations(
        identityWith(['Biostatistics', 'Fixture Studies Program']),
        ENTITY,
        schoolForDepartment,
      ),
    ).toEqual([]);
  });

  it('emits nothing without a stated Primary card, so a Secondary unit never sets the school', () => {
    expect(
      identityToResearchEntitySchoolObservations(identityWith([]), ENTITY, schoolForDepartment),
    ).toEqual([]);
    expect(
      identityToResearchEntitySchoolObservations(
        identityWith(undefined),
        ENTITY,
        schoolForDepartment,
      ),
    ).toEqual([]);
  });

  it('emits nothing for a profile off ysph.yale.edu', () => {
    expect(
      identityToResearchEntitySchoolObservations(
        identityWith(['Biostatistics'], MEDICINE_PROFILE_URL),
        ENTITY,
        schoolForDepartment,
      ),
    ).toEqual([]);
  });

  it('emits nothing without a catalog', () => {
    expect(
      identityToResearchEntitySchoolObservations(identityWith(['Biostatistics']), ENTITY, null),
    ).toEqual([]);
  });

  it('keeps the lane school reading latest-wins, so a changed card replaces the earlier school', () => {
    expect(
      LATEST_WINS_FINGERPRINT_FIELDS_BY_SOURCE['official-profile-pi-backfill']?.has('school'),
    ).toBe(true);
  });
});
