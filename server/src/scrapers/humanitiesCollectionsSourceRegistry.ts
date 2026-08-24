/**
 * Humanities / collections research-home source registry for scraper coverage
 * planning.
 *
 * The faculty-directory registry (`facultyDirectoryRegistry.ts`) tracks people
 * rosters; this sibling map tracks the non-faculty-directory humanities and
 * collections research homes the product model promises but that faculty-roster
 * and centers-index scrapers do not reach: digital-humanities projects, library
 * collections-as-data initiatives, and museum/archive research. It exists so the
 * reserved-but-under-produced entity types (`DIGITAL_HUMANITIES_PROJECT`,
 * `COLLECTIONS_INITIATIVE`, `ARCHIVE_OR_MUSEUM_PROJECT`) have a discoverable
 * follow-up backlog after the DHLab pilot (#1345).
 *
 * `url` values are crawl ENTRY POINTS (listing/index/landing pages). They must
 * never be persisted as an Observation/Source citation: every emitted artifact
 * cites the individual project's own page, not the index, per the
 * self-referential / index-page source guards (#516, #549). This registry is for
 * planning and reporting; it does not itself change scraper behavior.
 *
 * `coveredBy` names are `Source.name` keys from `sourceCoverageRegistry`.
 */
import type { SourceCoverageName } from './sourceCoverageRegistry';
import type { ResearchEntityType } from '../models/researchAccessTypes';

export type HumanitiesCollectionsCoverageStatus = 'covered' | 'partial' | 'gap';

export interface HumanitiesCollectionsSourceEntry {
  /** Listing / landing entry point. Never cited as a source; see module doc. */
  url: string;
  name: string;
  /** The reserved entity type this source is expected to produce. */
  entityType: ResearchEntityType;
  status: HumanitiesCollectionsCoverageStatus;
  coveredBy?: SourceCoverageName[];
  notes?: string;
}

export const HUMANITIES_COLLECTIONS_SOURCE_REGISTRY: HumanitiesCollectionsSourceEntry[] = [
  {
    url: 'https://github.com/YaleDHLab/dhlab-site/tree/master/_projects',
    name: 'Yale Digital Humanities Lab projects catalog',
    entityType: 'DIGITAL_HUMANITIES_PROJECT',
    status: 'covered',
    coveredBy: ['dh-lab-projects'],
    notes:
      'Pilot for the humanities research-home path (#1345). The rendered dhlab.yale.edu catalog was retired when the DHLab moved under library.yale.edu; the curated project catalog survives as the archived Jekyll source `_projects/*.md`, each entry carrying the project own official URL. dh-lab-projects walks that catalog as a crawl seed and cites each project own page. Projects without a citable own-page URL are skipped (fail closed).',
  },
  {
    url: 'https://peabody.yale.edu/explore/collections',
    name: 'Yale Peabody Museum research and collections programs',
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    status: 'gap',
    notes:
      'Museum-run, undergraduate-facing research and collections programs. Its own follow-up once the DIGITAL_HUMANITIES_PROJECT path is proven; would mint ARCHIVE_OR_MUSEUM_PROJECT homes citing each program own page.',
  },
  {
    url: 'https://beinecke.library.yale.edu/research-teaching',
    name: 'Beinecke Rare Book & Manuscript Library research programs',
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    status: 'gap',
    notes:
      'Beinecke runs undergraduate-facing research fellowships and collections research. Follow-up; would mint ARCHIVE_OR_MUSEUM_PROJECT homes citing each program own page.',
  },
  {
    url: 'https://library.yale.edu/explore-collections#digital',
    name: 'Yale Library collections-as-data initiatives',
    entityType: 'COLLECTIONS_INITIATIVE',
    status: 'gap',
    notes:
      'Yale Library collections-as-data / digital-collections initiatives. Follow-up; would mint COLLECTIONS_INITIATIVE homes citing each initiative own page.',
  },
];

export function getHumanitiesCollectionsGaps(): HumanitiesCollectionsSourceEntry[] {
  return HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.filter((entry) => entry.status !== 'covered');
}
