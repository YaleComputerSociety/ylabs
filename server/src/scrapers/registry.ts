/**
 * Central registry of available scrapers. Add new scrapers here so the CLI / orchestrator
 * can dispatch them by name.
 */
import { ScraperOrchestrator } from './orchestrator';
import { OpenAlexPaperScraper } from './sources/openAlexPaperScraper';
import { YsmAtoZScraper } from './sources/ysmAtoZScraper';
import { YseCentersScraper } from './sources/yseCentersScraper';
import { YaleDirectoryScraper } from './sources/yaleDirectoryScraper';
import { DepartmentRosterScraper } from './sources/departmentRosterScraper';
import { NihReporterScraper } from './sources/nihReporterScraper';
import { NsfAwardScraper } from './sources/nsfAwardScraper';
import { IndependentStudyCourseScraper } from './sources/independentStudyCourseScraper';
import { CentersInstitutesScraper } from './sources/centersInstitutesScraper';
import { UndergradFellowshipRecipientScraper } from './sources/undergradFellowshipRecipientScraper';
import { LabMicrositeUndergradLLMExtractor } from './sources/labMicrositeUndergradLLMExtractor';
import { ApifyGoogleScholarScraper } from './sources/apifyGoogleScholarScraper';
import { ApifyGoogleScholarBootstrapScraper } from './sources/apifyGoogleScholarBootstrapScraper';

export function buildOrchestrator(): ScraperOrchestrator {
  const o = new ScraperOrchestrator();
  o.register(new OpenAlexPaperScraper());
  o.register(new YsmAtoZScraper());
  o.register(new YseCentersScraper());
  o.register(new YaleDirectoryScraper());
  o.register(new DepartmentRosterScraper());
  o.register(new NihReporterScraper());
  o.register(new NsfAwardScraper());
  o.register(new IndependentStudyCourseScraper());
  o.register(new CentersInstitutesScraper());
  o.register(new UndergradFellowshipRecipientScraper());
  o.register(new LabMicrositeUndergradLLMExtractor());
  o.register(new ApifyGoogleScholarBootstrapScraper());
  o.register(new ApifyGoogleScholarScraper());
  return o;
}
