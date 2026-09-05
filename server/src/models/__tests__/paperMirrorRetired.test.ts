import { describe, expect, it } from 'vitest';
import * as models from '../index';
import { Observation } from '../observation';
import * as profileService from '../../services/profileService';

describe('Paper publication mirror retirement', () => {
  it('stops exporting the Paper and PaperAuthor models from the barrel', () => {
    expect('Paper' in models).toBe(false);
    expect('PaperAuthor' in models).toBe(false);
  });

  it('stops exporting the retired scholarly-link models from the barrel', () => {
    expect('ResearchScholarlyLink' in models).toBe(false);
    expect('ResearchScholarlyAttribution' in models).toBe(false);
  });

  it('drops the retired publication observation lanes from the schema enum', () => {
    const entityTypes: string[] = Observation.schema.path('entityType').options.enum;
    expect(entityTypes).not.toContain('paper');
    expect(entityTypes).not.toContain('scholarlyLink');
    expect(entityTypes).not.toContain('researchGroup');
    expect(entityTypes).not.toContain('listing');
  });

  it('keeps the live person and roster observation lanes', () => {
    const entityTypes: string[] = Observation.schema.path('entityType').options.enum;
    expect(entityTypes).toContain('user');
    expect(entityTypes).toContain('researchGroupMember');
    expect(entityTypes).toContain('researchEntity');
  });

  it('stops exporting the retired scholarly-link serve helpers', () => {
    expect('isPublicResearchPaperLink' in profileService).toBe(false);
    expect('isDatasetLikeScholarlyLink' in profileService).toBe(false);
    expect('scholarlyLinkToPublicLink' in profileService).toBe(false);
  });
});
