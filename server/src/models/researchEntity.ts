/**
 * Canonical Mongoose model for research entities.
 *
 * `research_entities` is the forward collection. The legacy schema lives in
 * `researchGroup.ts` only so historical fields can be reused without
 * registering a runtime `research_groups` model.
 */
import mongoose from 'mongoose';
import { researchGroupSchema } from './researchGroup';

export const ResearchEntity =
  mongoose.models.ResearchEntity ||
  mongoose.model('ResearchEntity', researchGroupSchema, 'research_entities');

export { researchGroupSchema as researchEntitySchema };
