/**
 * Central registry of available scrapers. Add new scrapers here so the CLI / orchestrator
 * can dispatch them by name.
 */
import { ScraperOrchestrator } from './orchestrator';
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
import { OfficialResearchHomeRosterScraper } from './sources/officialResearchHomeRosterScraper';

export function buildOrchestrator(): ScraperOrchestrator {
  const o = new ScraperOrchestrator();
  // The bibliographic paper pipeline (arXiv, OpenAlex, ORCID works, Europe PMC,
  // PubMed, Crossref) is deprecated and no longer registered, so it cannot run via
  // the CLI, cron, or a sweep. Historical source rows, observations, stored collections,
  // and the guarded materializer remain for rollback; verified Google Scholar and ORCID
  // profile identity links are kept on Researcher. See issues #207 and #260.
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
  o.register(new OfficialResearchHomeRosterScraper());
  return o;
}
