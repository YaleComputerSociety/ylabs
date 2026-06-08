/**
 * Central registry of available scrapers. Add new scrapers here so the CLI / orchestrator
 * can dispatch them by name.
 */
import { ScraperOrchestrator } from './orchestrator';
import { ArxivPreprintScraper } from './sources/arxivPreprintScraper';
import { OpenAlexPaperScraper } from './sources/openAlexPaperScraper';
import { OrcidWorksScraper } from './sources/orcidWorksScraper';
import { EuropePmcPaperScraper, PubMedPaperScraper } from './sources/europePmcPaperScraper';
import { CrossrefPaperScraper } from './sources/crossrefPaperScraper';
import { YsmAtoZScraper } from './sources/ysmAtoZScraper';
import { YseCentersScraper } from './sources/yseCentersScraper';
import { YaleResearchOfficialScraper } from './sources/yaleResearchOfficialScraper';
import { YaleDirectoryScraper } from './sources/yaleDirectoryScraper';
import { DepartmentRosterScraper } from './sources/departmentRosterScraper';
import { DepartmentUndergradResearchScraper } from './sources/departmentUndergradResearchScraper';
import { NihReporterScraper } from './sources/nihReporterScraper';
import { NsfAwardScraper } from './sources/nsfAwardScraper';
import { CentersInstitutesScraper } from './sources/centersInstitutesScraper';
import { UndergradFellowshipRecipientScraper } from './sources/undergradFellowshipRecipientScraper';
import { YaleCollegeFellowshipsOfficeScraper } from './sources/yaleCollegeFellowshipsOfficeScraper';
import { LabMicrositeDescriptionLLMExtractor } from './sources/labMicrositeDescriptionLLMExtractor';
import { LabMicrositeUndergradLLMExtractor } from './sources/labMicrositeUndergradLLMExtractor';
import { CenterAffiliationLLMExtractor } from './sources/centerAffiliationLLMExtractor';
import { CenterDirectorLLMExtractor } from './sources/centerDirectorLLMExtractor';
import { OfficialProfilePiBackfillScraper } from './sources/officialProfilePiBackfillScraper';
import { StudentDecisionLLMExtractor } from './sources/studentDecisionLLMExtractor';

export function buildOrchestrator(): ScraperOrchestrator {
  const o = new ScraperOrchestrator();
  o.register(new ArxivPreprintScraper());
  o.register(new OpenAlexPaperScraper());
  o.register(new OrcidWorksScraper());
  o.register(new EuropePmcPaperScraper());
  o.register(new PubMedPaperScraper());
  o.register(new CrossrefPaperScraper());
  o.register(new YsmAtoZScraper());
  o.register(new YseCentersScraper());
  o.register(new YaleResearchOfficialScraper());
  o.register(new YaleDirectoryScraper());
  o.register(new DepartmentRosterScraper());
  o.register(new DepartmentUndergradResearchScraper());
  o.register(new NihReporterScraper());
  o.register(new NsfAwardScraper());
  o.register(new CentersInstitutesScraper());
  o.register(new UndergradFellowshipRecipientScraper());
  o.register(new YaleCollegeFellowshipsOfficeScraper());
  o.register(new LabMicrositeDescriptionLLMExtractor());
  o.register(new LabMicrositeUndergradLLMExtractor());
  o.register(new CenterAffiliationLLMExtractor());
  o.register(new CenterDirectorLLMExtractor());
  o.register(new OfficialProfilePiBackfillScraper());
  o.register(new StudentDecisionLLMExtractor());
  return o;
}
