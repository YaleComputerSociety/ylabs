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
 * follow-up backlog after the DHLab pilot (#1345). Every entry has since
 * landed: the DHLab (`DIGITAL_HUMANITIES_PROJECT`), both
 * `ARCHIVE_OR_MUSEUM_PROJECT` homes (Peabody #1349, Beinecke #1455), and the
 * Yale Library collections-as-data `COLLECTIONS_INITIATIVE` producer, so the
 * backlog is fully covered. The map is retained for reporting and to record any
 * future humanities/collections coverage gap.
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
    status: 'covered',
    coveredBy: ['peabody-collections-research'],
    notes:
      'Museum-run, undergraduate-facing research and collections programs. peabody-collections-research walks the divisions index as a crawl seed and mints ARCHIVE_OR_MUSEUM_PROJECT homes citing each individual division own page (#1349 / PR #1367).',
  },
  {
    url: 'https://beinecke.library.yale.edu/beinecke/researchers',
    name: 'Beinecke Rare Book & Manuscript Library research programs',
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    status: 'covered',
    coveredBy: ['beinecke-collections-research'],
    notes:
      'Beinecke runs structured, undergraduate-relevant research fellowship programs. beinecke-collections-research walks the fellowships index as a crawl seed and mints ARCHIVE_OR_MUSEUM_PROJECT homes citing each individual program own page; discovery-only, fails closed on contact/access and never captures the awarded-fellow roster (#1455). Programs without a citable own-page description are skipped.',
  },
  {
    url: 'https://library.yale.edu/explore-collections#digital',
    name: 'Yale Library collections-as-data initiatives',
    entityType: 'COLLECTIONS_INITIATIVE',
    status: 'covered',
    coveredBy: ['library-collections-as-data'],
    notes:
      'Yale Library collections-as-data / digital-collections initiatives. library-collections-as-data walks the Yale University Library online exhibitions catalog as a crawl seed and mints COLLECTIONS_INITIATIVE homes citing each individual exhibition own page. This library-wide COLLECTIONS_INITIATIVE producer is the proper home for library-scale digital-collections platforms (Yale Library Digital Collections, Aviary audiovisual collections, the Yale Daily News Historical Archive, EliScholar) rather than the Beinecke ARCHIVE_OR_MUSEUM_PROJECT producer, to avoid misattributing them to Beinecke.',
  },
  {
    url: 'https://beinecke.library.yale.edu/beinecke/collections',
    name: 'Beinecke Rare Book & Manuscript Library curatorial units',
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    status: 'covered',
    coveredBy: ['beinecke-curatorial-units'],
    notes:
      'Rare-book/manuscript/archive research homes from the Beinecke curatorial-units catalog (#1457), reusing the Peabody path and complementing the Beinecke research-fellowships producer (#1455). beinecke-curatorial-units walks the units index as a crawl seed and cites each unit own page, emitting identity and the official-page summary. Verified live, the migrated site (library.yale.edu/beinecke) publishes no structured named-curator credit on unit pages (curator mentions are historical body prose), so the lead extractor fails closed and units earn the organizational reach-out ways-in from their official page rather than an identified named lead.',
  },
];

export function getHumanitiesCollectionsGaps(): HumanitiesCollectionsSourceEntry[] {
  return HUMANITIES_COLLECTIONS_SOURCE_REGISTRY.filter((entry) => entry.status !== 'covered');
}
