import { describe, expect, it } from 'vitest';
import * as models from '../index';
import { Observation } from '../observation';
import { isPublicResearchPaperLink } from '../../services/profileService';

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

  it('keeps verified Scholar and ORCID scholarly links as public destinations', () => {
    expect(isPublicResearchPaperLink({ url: 'https://scholar.google.com/citations?user=abc' })).toBe(
      true,
    );
    expect(isPublicResearchPaperLink({ externalIds: { doi: '10.1000/xyz' } })).toBe(true);
  });
});
