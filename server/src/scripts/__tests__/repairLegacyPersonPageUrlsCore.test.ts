import { describe, expect, it } from 'vitest';
import {
  isAdoptableProbe,
  pageTitleNamesPerson,
  personNameTokens,
  personTokensFromUrlLeaf,
  planLegacyPersonPageCandidates,
} from '../repairLegacyPersonPageUrlsCore';

const DEAD = 'https://sociology.yale.edu/people/rourke-obrien';
const LIVE = 'https://sociology.yale.edu/profile/rourke-obrien';
const OTHER = 'https://orcid.org/0000-0002-8932-3556';

describe('planLegacyPersonPageCandidates', () => {
  it('plans a rewrite for a dead legacy-prefix citation', () => {
    expect(
      planLegacyPersonPageCandidates(
        {
          slug: 'o-brien-ro274',
          name: "Rourke O'Brien - Research",
          studentVisibilityTier: 'student_ready',
          sourceUrls: [DEAD, OTHER],
        },
        (url) => (url === DEAD ? 'dead' : 'healthy'),
      ),
    ).toEqual([
      {
        entitySlug: 'o-brien-ro274',
        entityName: "Rourke O'Brien - Research",
        studentVisibilityTier: 'student_ready',
        deadUrl: DEAD,
        candidateUrl: LIVE,
        originalHealth: 'dead',
      },
    ]);
  });

  // These hosts run both prefixes, so a legacy URL confirmed healthy is left alone.
  it('ignores a legacy-prefix citation confirmed healthy', () => {
    expect(
      planLegacyPersonPageCandidates(
        { slug: 'x', name: 'A B', sourceUrls: [DEAD] },
        () => 'healthy',
      ),
    ).toEqual([]);
  });

  it('ignores a dead citation on an unmapped host', () => {
    expect(
      planLegacyPersonPageCandidates(
        {
          slug: 'x',
          name: 'A B',
          sourceUrls: ['https://quantuminstitute.yale.edu/people/luigi-frunzio'],
        },
        () => 'dead',
      ),
    ).toEqual([]);
  });

  it('ignores a dead citation already on the current prefix', () => {
    expect(
      planLegacyPersonPageCandidates({ slug: 'x', name: 'A B', sourceUrls: [LIVE] }, () => 'dead'),
    ).toEqual([]);
  });

  it('returns nothing for an entity with no slug or no urls', () => {
    expect(
      planLegacyPersonPageCandidates({ name: 'A B', sourceUrls: [DEAD] }, () => 'dead'),
    ).toEqual([]);
    expect(planLegacyPersonPageCandidates({ slug: 'x', name: 'A B' }, () => 'dead')).toEqual([]);
    expect(
      planLegacyPersonPageCandidates(
        { slug: 'x', name: 'A B', sourceUrls: [null, 7] },
        () => 'dead',
      ),
    ).toEqual([]);
  });
});

describe('an unverified verdict is not a healthy one', () => {
  // 11 dead citations on student_ready rows survived the first pass because the
  // health lane had never visited those URLs, and a missing verdict was read as
  // permission to skip. The caller probes before adopting, so planning them is safe.
  it('plans a legacy citation the health lane never visited', () => {
    const planned = planLegacyPersonPageCandidates(
      { slug: 'padmanabhan-lab-np274', name: 'Padmanabhan Lab', sourceUrls: [DEAD] },
      () => 'unverified',
    );
    expect(planned).toHaveLength(1);
    expect(planned[0].originalHealth).toBe('unverified');
  });

  it('marks an already-condemned original as dead so the caller can skip re-probing it', () => {
    expect(
      planLegacyPersonPageCandidates(
        { slug: 'x', name: 'A B', sourceUrls: [DEAD] },
        () => 'dead',
      )[0].originalHealth,
    ).toBe('dead');
  });
});

describe('personNameTokens', () => {
  it('strips product words so only the person name remains', () => {
    expect(personNameTokens("Rourke O'Brien Faculty Research")).toEqual(['rourke', 'brien']);
    expect(personNameTokens('Nir Navon - Research')).toEqual(['nir', 'navon']);
    expect(personNameTokens('Mammalian Evolutionary Morphology Lab')).toEqual([
      'mammalian',
      'evolutionary',
      'morphology',
    ]);
  });

  it('is empty for a non-string', () => {
    expect(personNameTokens(undefined)).toEqual([]);
  });
});

describe('the title gate matches the url leaf, not just the entity name', () => {
  // Real false refusals from the first Development dry-run: a lab entity name has
  // one usable token, and "Yu He" has none over two characters, yet both pages are
  // the right person. The leaf carries the full slug, so it is the reliable side.
  it('adopts a one-token entity name when the leaf names the person', () => {
    expect(
      pageTitleNamesPerson(
        'Keith Baker | Department of Physics',
        'Baker Lab',
        'https://physics.yale.edu/profile/keith-baker',
      ),
    ).toBe(true);
    expect(
      pageTitleNamesPerson(
        'Nikhil Padmanabhan | Department of Physics',
        'Padmanabhan Lab',
        'https://physics.yale.edu/profile/nikhil-padmanabhan',
      ),
    ).toBe(true);
  });

  it('adopts a short name whose tokens are under the length filter', () => {
    expect(
      pageTitleNamesPerson(
        'Yu He | Department of Physics',
        'Yu He Lab',
        'https://physics.yale.edu/profile/yu-he',
      ),
    ).toBe(true);
  });

  // The leaf path must not weaken the gate: this is the case it exists to stop.
  it('still refuses a 200 naming a different subject, leaf or not', () => {
    expect(
      pageTitleNamesPerson(
        'Welcome | Schoelkopf Lab',
        'Frunzio Lab',
        'https://quantuminstitute.yale.edu/profile/luigi-frunzio',
      ),
    ).toBe(false);
    expect(
      pageTitleNamesPerson(
        'Department of Applied Physics | Yale Engineering',
        'Kubica Lab',
        'https://quantuminstitute.yale.edu/profile/aleksander-kubica',
      ),
    ).toBe(false);
  });

  it('refuses when neither leaf nor name has two tokens', () => {
    expect(
      pageTitleNamesPerson('Navon | Physics', 'Lab', 'https://physics.yale.edu/profile/navon'),
    ).toBe(false);
  });
});

describe('the title gate', () => {
  it('adopts when the page title names the person', () => {
    expect(pageTitleNamesPerson('Nir Navon | Department of Physics', 'Nir Navon - Research')).toBe(
      true,
    );
    expect(
      pageTitleNamesPerson(
        'Phil Gorski | Yale Department of Sociology',
        'Phil Gorski Faculty Research',
      ),
    ).toBe(true);
  });

  // The reason the gate exists: a 200 whose page is somebody else entirely.
  it('refuses a 200 whose title names a different subject', () => {
    expect(pageTitleNamesPerson('Welcome | Schoelkopf Lab', 'Luigi Frunzio Faculty Research')).toBe(
      false,
    );
    expect(
      pageTitleNamesPerson(
        'Department of Applied Physics | Yale Engineering',
        'Aleksander Kubica Faculty Research',
      ),
    ).toBe(false);
  });

  it('refuses a soft-404 title and an empty title', () => {
    expect(
      pageTitleNamesPerson('Not Found (404) | Yale School of Medicine', 'Rosa Xicola Lab'),
    ).toBe(false);
    expect(pageTitleNamesPerson('', 'Nir Navon')).toBe(false);
    expect(pageTitleNamesPerson(undefined, 'Nir Navon')).toBe(false);
  });

  it('refuses when the entity name has fewer than two usable tokens', () => {
    expect(pageTitleNamesPerson('Navon | Department of Physics', 'Lab')).toBe(false);
  });
});

describe('isAdoptableProbe', () => {
  it('requires both a success status and a naming title', () => {
    expect(isAdoptableProbe({ status: 200, title: 'Nir Navon | Physics' }, 'Nir Navon')).toBe(true);
    expect(isAdoptableProbe({ status: 404, title: 'Nir Navon | Physics' }, 'Nir Navon')).toBe(
      false,
    );
    expect(isAdoptableProbe({ status: 200, title: 'Welcome | Schoelkopf Lab' }, 'Nir Navon')).toBe(
      false,
    );
    expect(isAdoptableProbe({ status: 0, title: '' }, 'Nir Navon')).toBe(false);
    expect(isAdoptableProbe(undefined, 'Nir Navon')).toBe(false);
  });

  // A 403 on a Yale Drupal host means the page is unpublished, not throttled.
  it('refuses a 403 access-denied page', () => {
    expect(
      isAdoptableProbe(
        { status: 403, title: 'Access denied | Department of Classics' },
        'Barbara Shailor',
      ),
    ).toBe(false);
  });
});
