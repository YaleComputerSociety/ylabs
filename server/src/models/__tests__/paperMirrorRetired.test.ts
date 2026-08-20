import fs from 'fs';
import { describe, expect, it } from 'vitest';
import * as models from '../index';
import { isPublicResearchPaperLink } from '../../services/profileService';

const modelSourceUrl = (relativePath: string): URL =>
  new URL(relativePath, import.meta.url);

describe('Paper publication mirror retirement', () => {
  it('removes the Paper and PaperAuthor model source files', () => {
    expect(fs.existsSync(modelSourceUrl('../paper.ts'))).toBe(false);
    expect(fs.existsSync(modelSourceUrl('../paperAuthor.ts'))).toBe(false);
  });

  it('removes the paper authorship policy and audit readers', () => {
    expect(fs.existsSync(modelSourceUrl('../../scrapers/paperAuthorshipPolicy.ts'))).toBe(false);
    expect(fs.existsSync(modelSourceUrl('../../scripts/paperAuthorshipAudit.ts'))).toBe(false);
  });

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
