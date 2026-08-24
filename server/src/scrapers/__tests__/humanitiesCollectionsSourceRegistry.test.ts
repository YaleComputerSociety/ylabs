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

  it('marks the DHLab pilot covered and the museum/library siblings as gaps', () => {
    const byType = new Map(
      HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.map((entry) => [entry.entityType, entry]),
    );
    expect(byType.get('DIGITAL_HUMANITIES_PROJECT')?.status).toBe('covered');
    expect(byType.get('DIGITAL_HUMANITIES_PROJECT')?.coveredBy).toContain('dh-lab-projects');

    const gapTypes = new Set(getHumanitiesCollectionsGaps().map((entry) => entry.entityType));
    expect(gapTypes.has('ARCHIVE_OR_MUSEUM_PROJECT')).toBe(true);
    expect(gapTypes.has('COLLECTIONS_INITIATIVE')).toBe(true);
  });
});
