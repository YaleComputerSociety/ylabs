import { describe, expect, it } from 'vitest';

import { stripCatalogChrome, stripLeadingProfileHeaderChrome } from '../descriptionHygiene';
import { sanitizeResearchEntityPublicDescriptionFields } from '../researchEntityDescriptionText';

const BREADCRUMB_BODY =
  'Home / About Us / Who We Are / Avery Sample Avery Sample Lecturer in Acting Avery Sample is an actress and teacher based in New York. She teaches an improvisational rehearsal method.';

const PROFILE_IMAGE_BODY =
  'Jordan Example Profile Image Professor in the Practice of Violin Example School of Music Coordinator of String Studies At YSM Since: 2006 Award(s): Example Medal Contact Jordan Example Violinist Jordan Example enjoys a career as a soloist and chamber musician.';

describe('stripLeadingProfileHeaderChrome', () => {
  it('removes a breadcrumb trail and the doubled name and title it leaves behind', () => {
    expect(stripLeadingProfileHeaderChrome(BREADCRUMB_BODY)).toBe(
      'Avery Sample is an actress and teacher based in New York. She teaches an improvisational rehearsal method.',
    );
  });

  it('removes a profile image header up to the contact line that repeats the name', () => {
    expect(stripLeadingProfileHeaderChrome(PROFILE_IMAGE_BODY)).toBe(
      'Violinist Jordan Example enjoys a career as a soloist and chamber musician.',
    );
  });

  it('leaves prose without a header marker untouched, even when it opens on a name and title', () => {
    const prose =
      'Avery Sample Avery Sample is repeated here by the source. Lecturer in Acting Avery Sample studies rehearsal methods.';
    expect(stripLeadingProfileHeaderChrome(prose)).toBe(prose);
  });

  it('does not treat a mid-body slash as a breadcrumb', () => {
    const prose =
      'The lab studies input / output models of the cell. Home visits are part of the work.';
    expect(stripLeadingProfileHeaderChrome(prose)).toBe(prose);
  });

  it('runs inside the shared catalog chrome strip every lane uses', () => {
    expect(stripCatalogChrome(BREADCRUMB_BODY)).toMatch(/^Avery Sample is an actress/);
  });

  it('runs on the served full description', () => {
    const served = sanitizeResearchEntityPublicDescriptionFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Avery Sample Faculty Research',
      fullDescription: BREADCRUMB_BODY,
    });
    expect(served.fullDescription).not.toMatch(/Home \/|Who We Are/);
    expect(served.fullDescription).toMatch(/is an actress and teacher/);
  });
});
