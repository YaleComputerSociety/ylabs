import { describe, expect, it } from 'vitest';
import * as models from '../index';
import { isPublicResearchPaperLink } from '../../services/profileService';

describe('Paper publication mirror retirement', () => {
  it('stops exporting the Paper and PaperAuthor models from the barrel', () => {
    expect('Paper' in models).toBe(false);
    expect('PaperAuthor' in models).toBe(false);
  });

  it('retains the sanctioned scholarly-link models', () => {
    expect(models.ResearchScholarlyLink.collection.name).toBe('research_scholarly_links');
    expect(models.ResearchScholarlyAttribution.collection.name).toBe(
      'research_scholarly_attributions',
    );
  });

  it('keeps verified Scholar and ORCID scholarly links as public destinations', () => {
    expect(isPublicResearchPaperLink({ url: 'https://scholar.google.com/citations?user=abc' })).toBe(
      true,
    );
    expect(isPublicResearchPaperLink({ externalIds: { doi: '10.1000/xyz' } })).toBe(true);
  });
});
