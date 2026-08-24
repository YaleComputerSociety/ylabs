import { describe, expect, it } from 'vitest';
import {
  HUMANITIES_COLLECTIONS_SOURCE_REGISTRY,
  getHumanitiesCollectionsGaps,
} from '../humanitiesCollectionsSourceRegistry';
import { getSourceCoverage } from '../sourceCoverageRegistry';
import { researchEntityTypes } from '../../models/researchAccessTypes';

const statuses = new Set(['covered', 'partial', 'gap']);
const validEntityTypes = new Set<string>(researchEntityTypes);

describe('humanitiesCollectionsSourceRegistry', () => {
  it('uses unique https listing URLs and supported status/entity-type values', () => {
    const urls = HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const entry of HUMANITIES_COLLECTIONS_SOURCE_REGISTRY) {
      expect(entry.url, entry.name).toMatch(/^https:\/\//);
      expect(statuses.has(entry.status), entry.name).toBe(true);
      expect(validEntityTypes.has(entry.entityType), entry.name).toBe(true);
    }
  });

  it('references only coveredBy sources that exist and requires one for covered entries', () => {
    for (const entry of HUMANITIES_COLLECTIONS_SOURCE_REGISTRY) {
      for (const source of entry.coveredBy ?? []) {
        expect(getSourceCoverage(source), `${entry.name}:${source}`).toBeTruthy();
      }
      if (entry.status === 'covered') {
        expect(entry.coveredBy && entry.coveredBy.length > 0, entry.name).toBe(true);
      }
    }
  });

  it('has the whole humanities-collections backlog covered with no remaining gaps', () => {
    const dhLab = HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.find(
      (entry) => entry.entityType === 'DIGITAL_HUMANITIES_PROJECT',
    );
    expect(dhLab?.status).toBe('covered');
    expect(dhLab?.coveredBy).toContain('dh-lab-projects');

    const archiveHomes = HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.filter(
      (entry) => entry.entityType === 'ARCHIVE_OR_MUSEUM_PROJECT',
    );
    expect(archiveHomes.length).toBeGreaterThanOrEqual(2);
    for (const entry of archiveHomes) {
      expect(entry.status, entry.name).toBe('covered');
    }
    expect(archiveHomes.flatMap((entry) => entry.coveredBy ?? [])).toEqual(
      expect.arrayContaining(['peabody-collections-research', 'beinecke-collections-research']),
    );

    const library = HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.find(
      (entry) => entry.entityType === 'COLLECTIONS_INITIATIVE',
    );
    expect(library?.status).toBe('covered');
    expect(library?.coveredBy).toContain('library-collections-as-data');

    expect(getHumanitiesCollectionsGaps()).toEqual([]);
  });
});
