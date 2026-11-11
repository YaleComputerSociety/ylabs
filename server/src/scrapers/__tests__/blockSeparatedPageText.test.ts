import { describe, expect, it } from 'vitest';
import { CenterDirectorLLMExtractor } from '../sources/centerDirectorLLMExtractor';
import { parsePhysicsUndergradResearchPage } from '../sources/departmentUndergradResearchScraper';
import { officialPageText } from '../utils/programOfficialPage';

const PHYSICS_CONFIG = {
  key: 'physics',
  url: 'https://physics.example.edu/undergrad',
  department: 'Physics',
  school: 'Yale Faculty of Arts and Sciences',
  parser: 'physics-project-list' as const,
};

const PHYSICS_HTML_WITH_BLOCK_CONTACT = `
<main>
  <h1>Undergraduate Research</h1>
  <h2>Active Research in the Physics Department</h2>
  <h3>Quill Fennimore</h3>
  <div class="contact"><div>Department of Physics</div><div>quill.fennimore@yale.edu</div></div>
  <p>Undergraduates join the group each term to build detectors and analyze collision data.</p>
</main>`;

describe('page text keeps adjacent blocks apart (#5720)', () => {
  it('reads the address after a department block, not the department fused onto it', () => {
    const [record] = parsePhysicsUndergradResearchPage(
      PHYSICS_HTML_WITH_BLOCK_CONTACT,
      PHYSICS_CONFIG,
    );
    expect(record.contactEmail).toBe('quill.fennimore@yale.edu');
    expect(record.evidenceQuote).toContain('Department of Physics quill.fennimore@yale.edu');
  });

  it('sends the director model a name kept apart from the title block beside it', async () => {
    const sentPageText: string[] = [];
    const leadershipHtml = `<html><body>
      <h1>Center for Synthetic Tides</h1>
      <div class="person"><div class="name">Ondine Marlowe</div><div class="title">Director</div></div>
      <p>The center studies coastal circulation, sediment transport and the instruments that measure them.</p>
    </body></html>`;
    const extractor = new CenterDirectorLLMExtractor({
      apiKey: 'test-key',
      fetchPage: async (url) => ({ url, html: leadershipHtml }),
      callLLM: async (input) => {
        sentPageText.push(input.pageText);
        return { director: null };
      },
      centerFinder: async () => [],
      priorReadFinder: async () => null,
    });
    await extractor.extractDirectorForCenter({
      slug: 'center-synthetic-tides',
      name: 'Center for Synthetic Tides',
      websiteUrl: 'https://tides.example.edu/',
    });
    expect(sentPageText).toHaveLength(1);
    expect(sentPageText[0]).toContain('Ondine Marlowe Director');
    expect(sentPageText[0]).not.toContain('MarloweDirector');
  });

  it('keeps a program page heading apart from the fund name after it', () => {
    const text = officialPageText(
      '<html><head><title>Awards</title></head><body><h2>Funding</h2><div>Halvard Research Fund</div></body></html>',
    );
    expect(text).toBe('Awards Funding Halvard Research Fund');
  });

  it('reads the same page the same way twice', () => {
    const first = parsePhysicsUndergradResearchPage(
      PHYSICS_HTML_WITH_BLOCK_CONTACT,
      PHYSICS_CONFIG,
    );
    const second = parsePhysicsUndergradResearchPage(
      PHYSICS_HTML_WITH_BLOCK_CONTACT,
      PHYSICS_CONFIG,
    );
    expect(second).toEqual(first);
  });
});
