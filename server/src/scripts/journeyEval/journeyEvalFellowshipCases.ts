import {
  programSurfaceCases,
  type ProgramJourneyCase,
  type ProgramSurface,
} from './journeyEvalProgramCases';

export const FELLOWSHIPS_SURFACE: ProgramSurface = {
  id: 'fellowships',
  label: 'Fellowships',
  filters: { programCategory: ['FELLOWSHIP'] },
  offersEveryFilterOption: false,
};

export const fellowshipJourneyCases: readonly ProgramJourneyCase[] =
  programSurfaceCases(FELLOWSHIPS_SURFACE);
