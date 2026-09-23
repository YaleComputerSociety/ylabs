import { describe, expect, it, vi } from 'vitest';
import {
  classifyYaleProfilePersonPresence,
  hasBiographicalProse,
  isYaleProfileUrl,
  probeYaleProfileDepartureEvidence,
  visibleTextFromHtml,
} from '../yaleProfileDepartureEvidence';

const page = (html: string, status = 200) => ({ status, html });

const TOMBSTONE = `<html><head><title>Somebody | Department of Political Science</title></head>
  <body><h1>Somebody</h1><div class="view-empty"><p>No people to display.</p></div>
  <footer>Yale Accessibility at Yale Privacy policy Copyright 2026 Yale University</footer></body></html>`;

const LIVE = `<html><body><h1>Somebody</h1><div>Assistant Professor of Political Science</div>
  <p>Research centers on the U.S. Congress.</p></body></html>`;

describe('visibleTextFromHtml', () => {
  it('drops script and style bodies so their contents cannot supply a role word', () => {
    const text = visibleTextFromHtml(
      '<style>.professor{color:red}</style><script>var director=1</script><p>No people to display.</p>',
    );
    expect(text).toBe('No people to display.');
  });
});

describe('classifyYaleProfilePersonPresence', () => {
  it('reads a person-less 200 as an assertion of absence', () => {
    expect(classifyYaleProfilePersonPresence(page(TOMBSTONE))).toBe('person_absent');
  });

  it('reads a page naming an appointment as present', () => {
    expect(classifyYaleProfilePersonPresence(page(LIVE))).toBe('person_present');
  });

  // A role word outranks the marker rather than the other way round, because the
  // cost of the two mistakes is not symmetric: declining to act leaves a stale row
  // for an operator, acting wrongly removes a real research home from students.
  it('treats a page carrying both signals as present', () => {
    expect(
      classifyYaleProfilePersonPresence(
        page('<h1>Somebody</h1><p>Professor of Physics</p><p>No people to display.</p>'),
      ),
    ).toBe('person_present');
  });

  it('never asserts absence from a non-2xx status, whatever the body says', () => {
    expect(classifyYaleProfilePersonPresence(page(TOMBSTONE, 404))).toBe('indeterminate');
    expect(classifyYaleProfilePersonPresence(page(TOMBSTONE, 403))).toBe('indeterminate');
    expect(classifyYaleProfilePersonPresence(page(TOMBSTONE, 301))).toBe('indeterminate');
  });

  it('is indeterminate for an empty body and for a missing page', () => {
    expect(classifyYaleProfilePersonPresence(page(''))).toBe('indeterminate');
    expect(classifyYaleProfilePersonPresence(null)).toBe('indeterminate');
  });

  it('is indeterminate when neither signal appears, rather than guessing', () => {
    expect(classifyYaleProfilePersonPresence(page('<h1>Somebody</h1>'))).toBe('indeterminate');
  });

  // The two-condition rule's false positive (#3168), reproduced from the page that
  // produced it: a full biography plus a SECOND, empty people view whose empty
  // state is the same string, for somebody whose bio never states a title. Both
  // original conditions hold and the person is present and correct.
  it('reads a biography followed by an empty people view as present, not absent', () => {
    const html = `<h1>Somebody</h1>
      <p>After completing a B.A. in Arabic and Linguistics and an M.A. in International
      Studies, Somebody has worked in higher education and for international non-profits
      in London and New York City.</p>
      <p>Somebody has since been teaching Modern Standard Arabic in high schools and
      universities in Connecticut.</p>
      <div class="view-empty">No people to display.</div>`;
    expect(classifyYaleProfilePersonPresence(page(html))).toBe('person_present');
  });

  it('still asserts absence when the marker is all the page has left to say', () => {
    const html = `<title>Somebody | Department of Political Science</title>
      <nav>Home People Academics Contacts News Calendar Resources Travel &amp; Directions</nav>
      <h1>Somebody</h1><div class="view-empty">No people to display.</div>
      <footer>Yale Accessibility at Yale Privacy policy Copyright 2026 Yale University</footer>`;
    expect(classifyYaleProfilePersonPresence(page(html))).toBe('person_absent');
  });
});

describe('hasBiographicalProse', () => {
  it('ignores the empty-state marker itself, which is a short sentence', () => {
    expect(hasBiographicalProse('Somebody No people to display.')).toBe(false);
  });

  it('does not mistake a navigation menu or a postal address for a biography', () => {
    expect(
      hasBiographicalProse(
        'Home People Academics Contacts News Calendar Resources Travel Directions Faculty Postdocs Staff',
      ),
    ).toBe(false);
    expect(
      hasBiographicalProse(
        'Postal Address: P.O. Box 208287 New Haven, CT 06520-8287 T 203-432-2944',
      ),
    ).toBe(false);
  });

  it('detects a bio sentence with no role word in it', () => {
    expect(
      hasBiographicalProse(
        'Somebody has since been teaching Modern Standard Arabic in high schools and universities in Connecticut.',
      ),
    ).toBe(true);
  });
});

describe('isYaleProfileUrl', () => {
  it('accepts Yale directory profile paths on any subdomain', () => {
    expect(isYaleProfileUrl('https://politicalscience.yale.edu/people/somebody')).toBe(true);
    expect(isYaleProfileUrl('https://medicine.yale.edu/profile/abc123/')).toBe(true);
    expect(isYaleProfileUrl('https://engineering.yale.edu/faculty/somebody')).toBe(true);
  });

  it('rejects a personal website, which is the page a relocated professor keeps', () => {
    expect(isYaleProfileUrl('https://somebody.com/')).toBe(false);
    expect(isYaleProfileUrl('https://yale.edu.evil.test/people/somebody')).toBe(false);
    expect(isYaleProfileUrl('https://politicalscience.yale.edu/')).toBe(false);
    expect(isYaleProfileUrl(undefined)).toBe(false);
  });
});

describe('probeYaleProfileDepartureEvidence', () => {
  it('asserts absence when the only Yale profile is person-less', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(TOMBSTONE));
    const evidence = await probeYaleProfileDepartureEvidence(
      ['https://politicalscience.yale.edu/people/somebody'],
      fetchPage,
    );
    expect(evidence).toMatchObject({ probed: 1, assertsAbsence: true });
  });

  it('withholds the verdict when a second Yale profile still names the person', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(TOMBSTONE))
      .mockResolvedValueOnce(page(LIVE));
    const evidence = await probeYaleProfileDepartureEvidence(
      [
        'https://politicalscience.yale.edu/people/somebody',
        'https://economics.yale.edu/people/somebody',
      ],
      fetchPage,
    );
    expect(evidence.assertsAbsence).toBe(false);
    expect(evidence.absentUrls).toHaveLength(1);
    expect(evidence.presentUrls).toHaveLength(1);
  });

  it('filters non-Yale citations out before probing anything', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(TOMBSTONE));
    const evidence = await probeYaleProfileDepartureEvidence(
      ['https://somebody.com/', 'https://scholar.google.com/citations?user=x'],
      fetchPage,
    );
    expect(fetchPage).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ probed: 0, assertsAbsence: false });
  });

  it('fails closed when the fetch throws', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const evidence = await probeYaleProfileDepartureEvidence(
      ['https://politicalscience.yale.edu/people/somebody'],
      fetchPage,
    );
    expect(evidence).toMatchObject({ probed: 1, assertsAbsence: false });
  });
});
