import { withoutMeshSourcedGeographicResearchAreas } from '../scrapers/utils/meshGeographicDescriptors';
import {
  dropDomainIncoherentUnsourcedResearchAreas,
  type ResearchAreaCoherenceContext,
} from './researchAreaDomainCoherence';

// The served DTO, the search index document, and the journey:eval topic attribution
// case all call this, so a new served topic guard belongs here rather than at one
// call site, where the harness would report its drops as unexplained.
export function withholdUnservableResearchAreas(
  areas: readonly string[],
  fieldProvenance: unknown,
  coherenceContext: ResearchAreaCoherenceContext,
): string[] {
  return dropDomainIncoherentUnsourcedResearchAreas(
    withoutMeshSourcedGeographicResearchAreas(areas, fieldProvenance),
    fieldProvenance,
    coherenceContext,
  );
}
