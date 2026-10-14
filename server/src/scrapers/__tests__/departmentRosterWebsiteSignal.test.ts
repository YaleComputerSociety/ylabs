import { describe, expect, it } from 'vitest';
import { pathNamesALab, profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';

const PROFILE_URL = 'https://earth.yale.edu/profile/ada-fixture';

const enrich = (body: string) =>
  profileEnrichmentFromHtml(
    `<html><head><link rel="canonical" href="${PROFILE_URL}"></head><body><main>
       <h1 class="page-title">Ada Fixture</h1>
       <div class="person-title">Professor of Fixtures</div>
       ${body}
     </main></body></html>`,
    PROFILE_URL,
  );

describe('pathNamesALab', () => {
  it.each([
    ['/lab/fixture/', true],
    ['/labs/', true],
    ['/histmed/community-fixture-lab/', true],
    ['/fixture-laboratory.html', true],
    ['/en/publications/laboratory-degradation-of-fixture-lipids', false],
    ['/lab-yale-fixture-geochemistry-center', false],
    ['/courses/laboratory-principles-of-fixtures', false],
    ['/about/a-to-z-index/atoz/lab-websites', false],
    ['/teaching/lab-work/', false],
  ])('%s -> %s', (pathname, expected) => {
    expect(pathNamesALab(pathname)).toBe(expected);
  });
});

describe('profile website harvest', () => {
  it('does not take a publication whose title slug opens with a lab word', () => {
    const result = enrich(
      `<ul><li>Fixture, A. 2009 <a href="https://research-information.example.ac.uk/en/publications/laboratory-degradation-of-fixture-lipids">Degradation of fixture lipids.</a> Journal 1, 2-3.</li></ul>`,
    );
    expect(result.labUrl).toBeUndefined();
  });

  it('does not take an umbrella center page whose slug opens with a lab word', () => {
    const result = enrich(
      `<p>Welcome to the Fixture Group! We are a part of the <a href="https://earth.yale.edu/lab-yale-fixture-geochemistry-center">Yale Fixture Geochemistry Center</a>.</p>`,
    );
    expect(result.labUrl).toBeUndefined();
  });

  it('retracts the website slot when the only lab link is a national laboratory', () => {
    const result = enrich(
      `<p>Fixture experiments run at the <a href="https://www.fixture-national-lab.gov/world/">Fixture National Laboratory</a> on Long Island.</p>`,
    );
    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('empty');
  });

  it('keeps a lab whose slug ends in its lab word', () => {
    const result = enrich(
      `<p>Fixture co-directs the <a href="https://medicine.yale.edu/histmed/community-fixture-lab/">Community Fixture Lab</a>.</p>`,
    );
    expect(result.labUrl).toBe('https://medicine.yale.edu/histmed/community-fixture-lab/');
  });

  it('keeps a link whose label says it is the lab website', () => {
    const result = enrich(`<p><a href="https://fixture.example.org/">Lab Website</a></p>`);
    expect(result.labUrl).toBe('https://fixture.example.org/');
  });

  it('does not take a center link whose only lab word is in its hidden title', () => {
    const result = enrich(
      `<p>We are a part of the <a href="https://earth.yale.edu/fixture-geochemistry-center" title="Lab - Yale Fixture Geochemistry Center">Yale Fixture Geochemistry Center</a>.</p>`,
    );
    expect(result.labUrl).toBeUndefined();
  });

  it('keeps a short call-to-action label that names the lab', () => {
    const result = enrich(
      `<p><a href="https://www.fixturelab.example.org/">Learn More About My Lab!</a></p>`,
    );
    expect(result.labUrl).toBe('https://www.fixturelab.example.org/');
  });

  it('keeps a call-to-action sentence that closes on the lab word', () => {
    const result = enrich(
      `<p><a href="https://thefixturelab.example.org/">Learn more about the Fixture Lab.</a></p>`,
    );
    expect(result.labUrl).toBe('https://thefixturelab.example.org/');
  });

  it('keeps a long lab name used as link text', () => {
    const result = enrich(
      `<p><a href="https://fixture.example.org/">Laboratory for the Study of Molecular Mechanisms of Fixture Disease</a></p>`,
    );
    expect(result.labUrl).toBe('https://fixture.example.org/');
  });

  it('does not take a citation sentence that opens with a lab word', () => {
    const result = enrich(
      `<ul><li><a href="https://journal.example.org/articles/1234">Laboratory degradation of fixture lipids in soils.</a></li></ul>`,
    );
    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('empty');
  });
});
