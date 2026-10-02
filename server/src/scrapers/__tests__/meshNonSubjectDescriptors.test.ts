import { describe, expect, it } from 'vitest';
import { profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';
import { parseYsmProfileResearch } from '../sources/ysmMeshKeywordScraper';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';
import { sanitizeServedResearchEntityCopyFields } from '../../utils/researchEntityDescriptionText';
import {
  MESH_AGE_GROUP_CHECK_TAGS,
  isMeshGeographicDescriptor,
  isMeshIndexedProfileUrl,
  isMeshNonSubjectDescriptor,
  withoutMeshNonSubjectDescriptors,
} from '../utils/meshNonSubjectDescriptors';

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
      withoutMeshNonSubjectDescriptors(['Autistic Disorder', 'China', 'Epidemiology', 'Korea']),
    ).toEqual(['Autistic Disorder', 'Epidemiology']);
  });

  it('recognises age-group and subject check tags and study-context headings', () => {
    for (const term of [
      'Adolescent',
      'infant, newborn',
      'Aged, 80 and over',
      'Humans',
      'Mice',
      'Diagnosis',
      'Treatment Outcome',
      'Risk Factors',
    ]) {
      expect(isMeshNonSubjectDescriptor(term)).toBe(true);
    }
    expect(isMeshNonSubjectDescriptor('China')).toBe(true);
  });

  it('keeps subject headings that only contain an age, check-tag or study word', () => {
    for (const term of [
      'Breast Neoplasms',
      'Adolescent Development',
      'Infant, Premature',
      'Pregnancy',
      'Pregnancy Complications',
      'Diagnostic Imaging',
      'Child Psychiatry',
    ]) {
      expect(isMeshNonSubjectDescriptor(term)).toBe(false);
    }
  });

  it('takes every age-group check tag from MeSH tree M01.060', () => {
    for (const descriptor of MESH_AGE_GROUP_CHECK_TAGS) {
      expect(descriptor.treeNumbers.every((tree) => tree.startsWith('M01.060'))).toBe(true);
    }
  });

  it('drops age groups, check tags and study-context headings from a keyword list', () => {
    expect(
      withoutMeshNonSubjectDescriptors([
        'Breast Neoplasms',
        'Adolescent',
        'Treatment Outcome',
        'Humans',
      ]),
    ).toEqual(['Breast Neoplasms']);
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

  it('ysm-mesh-keyword emits no age group, check tag or study-context heading as a research area', () => {
    const research = parseYsmProfileResearch(
      ysmProfilePage(['Breast Neoplasms', 'Adolescent', 'Treatment Outcome', 'Mice']),
      'https://medicine.yale.edu/profile/ada-fixture/',
    );
    expect(research?.meshTerms).toEqual(['Breast Neoplasms']);
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

  it('withholds a stored age group, check tag and study-context heading at serve time', () => {
    const stored = storedEntity(
      ['Breast Neoplasms', 'Adolescent', 'Treatment Outcome', 'Humans'],
      MESH_PROFILE_URL,
    );
    expect(buildResearchEntitySearchIndexDocument(stored)?.researchAreas).toEqual([
      'Breast Neoplasms',
    ]);
    expect(sanitizeServedResearchEntityCopyFields(stored).researchAreas).toEqual([
      'Breast Neoplasms',
    ]);
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
