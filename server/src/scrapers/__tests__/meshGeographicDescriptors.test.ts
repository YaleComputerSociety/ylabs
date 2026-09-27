import { describe, expect, it } from 'vitest';
import { profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';
import { parseYsmProfileResearch } from '../sources/ysmMeshKeywordScraper';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';
import { sanitizeServedResearchEntityCopyFields } from '../../utils/researchEntityDescriptionText';
import {
  isMeshGeographicDescriptor,
  isMeshIndexedProfileUrl,
  withoutMeshGeographicDescriptors,
} from '../utils/meshGeographicDescriptors';

const MESH_PROFILE_URL = 'https://ysph.yale.edu/profile/ada-fixture/';
const HUMANITIES_PROFILE_URL = 'https://history.yale.edu/people/ada-fixture';

const interestsPage = (canonicalUrl: string, interests: string[]): string =>
  `<html><head><link rel="canonical" href="${canonicalUrl}"></head><body><main>
     <h1 class="page-title">Ada Fixture</h1>
     <h3>Research Interests</h3>
     <ul>${interests.map((interest) => `<li>${interest}</li>`).join('')}</ul>
   </main></body></html>`;

const ysmProfilePage = (meshKeywords: string[]): string => {
  const pageData = {
    mainComponents: [
      {
        key: 'ProfileDetails',
        model: {
          fullName: 'Ada Fixture',
          sections: [
            {
              sectionType: 'research',
              meshKeywords: meshKeywords.map((name, index) => ({ id: 2000 + index, name })),
            },
          ],
        },
      },
    ],
  };
  return `<html><body><script id="page-data" type="application/json">${JSON.stringify(pageData)}</script></body></html>`;
};

describe('MeSH geographic descriptors', () => {
  it('recognises Z01 place names regardless of case and spacing', () => {
    expect(isMeshGeographicDescriptor('China')).toBe(true);
    expect(isMeshGeographicDescriptor('  africa south of the  Sahara ')).toBe(true);
    expect(isMeshGeographicDescriptor("Cote d'Ivoire")).toBe(true);
  });

  it('keeps subject headings, including ones that name a place inside a longer phrase', () => {
    expect(isMeshGeographicDescriptor('Global Health')).toBe(false);
    expect(isMeshGeographicDescriptor('Chinese Politics')).toBe(false);
    expect(isMeshGeographicDescriptor('Asian Americans')).toBe(false);
  });

  it('drops only the place names from a keyword list', () => {
    expect(
      withoutMeshGeographicDescriptors(['Autistic Disorder', 'China', 'Epidemiology', 'Korea']),
    ).toEqual(['Autistic Disorder', 'Epidemiology']);
  });

  it('scopes the MeSH-indexed hosts to the YSM profile platform', () => {
    expect(isMeshIndexedProfileUrl('https://medicine.yale.edu/profile/ada-fixture/')).toBe(true);
    expect(isMeshIndexedProfileUrl(MESH_PROFILE_URL)).toBe(true);
    expect(isMeshIndexedProfileUrl(HUMANITIES_PROFILE_URL)).toBe(false);
    expect(isMeshIndexedProfileUrl('not a url')).toBe(false);
  });
});

describe('lanes that read a MeSH keyword list', () => {
  it('ysm-mesh-keyword emits no study-site place as a research area', () => {
    const research = parseYsmProfileResearch(
      ysmProfilePage(['Africa', 'China', 'Genetics', 'Global Health']),
      'https://medicine.yale.edu/profile/ada-fixture/',
    );
    expect(research?.meshTerms).toEqual(['Genetics', 'Global Health']);
  });

  it('ysm-mesh-keyword stays fail-closed when every keyword is a place', () => {
    expect(
      parseYsmProfileResearch(
        ysmProfilePage(['China', 'Taiwan']),
        'https://medicine.yale.edu/profile/ada-fixture/',
      ),
    ).toBeNull();
  });

  it('dept-faculty-roster drops places from interests on a MeSH-indexed profile', () => {
    const result = profileEnrichmentFromHtml(
      interestsPage(MESH_PROFILE_URL, ['Epidemiology', 'Vietnam', 'American Samoa']),
      MESH_PROFILE_URL,
    );
    expect(result.researchInterests).toEqual(['Epidemiology']);
    expect(result.topics).toEqual(['Epidemiology']);
  });

  it('dept-faculty-roster keeps a place a humanities profile names as its field', () => {
    const result = profileEnrichmentFromHtml(
      interestsPage(HUMANITIES_PROFILE_URL, ['Latin America', 'Brazil']),
      HUMANITIES_PROFILE_URL,
    );
    expect(result.researchInterests).toEqual(['Latin America', 'Brazil']);
  });

  const storedEntity = (researchAreas: string[], provenanceSourceUrl: string) => ({
    _id: 'entity-mesh-fixture',
    slug: 'ysm-faculty-fixture-ada',
    name: 'Ada Fixture Lab',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    archived: false,
    researchAreas,
    fieldProvenance: {
      researchAreas: { sourceName: 'ysm-mesh-keyword', sourceUrl: provenanceSourceUrl },
    },
  });

  it('withholds a stored all-place MeSH list that no re-run can supersede', () => {
    const stored = storedEntity(
      ['China', 'Taiwan'],
      'https://medicine.yale.edu/profile/ada-fixture/',
    );
    expect(buildResearchEntitySearchIndexDocument(stored)).not.toHaveProperty('researchAreas');
    expect(sanitizeServedResearchEntityCopyFields(stored).researchAreas).toEqual([]);
  });

  it('withholds only the places from a stored MeSH list at serve time', () => {
    const stored = storedEntity(['Genetics', 'China'], MESH_PROFILE_URL);
    expect(buildResearchEntitySearchIndexDocument(stored)?.researchAreas).toEqual(['Genetics']);
    expect(sanitizeServedResearchEntityCopyFields(stored).researchAreas).toEqual(['Genetics']);
  });

  it('serves a place a non-MeSH source recorded as the topic', () => {
    const stored = storedEntity(['Latin America', 'Brazil'], HUMANITIES_PROFILE_URL);
    expect(buildResearchEntitySearchIndexDocument(stored)?.researchAreas).toEqual([
      'Latin America',
      'Brazil',
    ]);
    expect(sanitizeServedResearchEntityCopyFields(stored).researchAreas).toEqual([
      'Latin America',
      'Brazil',
    ]);
  });
});
