import { describe, expect, it, vi } from 'vitest';
import {
  LabSiteUndergradInvitationScraper,
  UNDERGRAD_INVITATION_FIELD,
} from '../sources/labSiteUndergradInvitationScraper';
import type { CandidateLab } from '../sources/labMicrositeUndergradLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

const lab = (slug: string, websiteUrl: string): CandidateLab => ({
  _id: slug,
  slug,
  name: `${slug} lab`,
  websiteUrl,
  archived: false,
  manuallyLockedFields: [],
});

const html = (body: string, links = '') =>
  `<html><body><main>${links}<p>${body}</p></main></body></html>`;

function runContext(emitted: ObservationInput[]): ScraperContext {
  return {
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'lab-site-undergrad-invitation',
    sourceWeight: 0.8,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      exhaustive: true,
      referenceDate: new Date('2026-10-18T12:00:00Z'),
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

async function run(pages: Record<string, string>, labs: CandidateLab[]) {
  const emitted: ObservationInput[] = [];
  const scraper = new LabSiteUndergradInvitationScraper({
    labFinder: async () => labs,
    fetchPage: async (url) => (pages[url] ? { url, html: pages[url] } : null),
  });
  const result = await scraper.run(runContext(emitted));
  return { emitted, result };
}

describe('LabSiteUndergradInvitationScraper', () => {
  it('reads an invitation from a linked join page and cites that page', async () => {
    const { emitted } = await run(
      {
        'https://alpha.example.edu/': html('We study cells.', '<a href="/join">Join us</a>'),
        'https://alpha.example.edu/join': html(
          'We are actively recruiting undergraduate researchers to join our lab.',
        ),
      },
      [lab('alpha-lab', 'https://alpha.example.edu/')],
    );
    expect(emitted).toEqual([
      expect.objectContaining({
        entityKey: 'alpha-lab',
        field: UNDERGRAD_INVITATION_FIELD,
        value: {
          level: 'actively_hiring',
          quote: 'We are actively recruiting undergraduate researchers to join our lab.',
          sourceUrl: 'https://alpha.example.edu/join',
        },
      }),
    ]);
  });

  it('states no value when the lab pages carry no invitation', async () => {
    const { emitted } = await run({ 'https://beta.example.edu/': html('We study rocks.') }, [
      lab('beta-lab', 'https://beta.example.edu/'),
    ]);
    expect(emitted).toEqual([
      expect.objectContaining({
        entityKey: 'beta-lab',
        value: null,
        assertsNoValueFor: [UNDERGRAD_INVITATION_FIELD],
      }),
    ]);
  });

  it('emits nothing for a row whose home page could not be read', async () => {
    const { emitted } = await run({ 'https://beta.example.edu/': html('We study rocks.') }, [
      lab('beta-lab', 'https://beta.example.edu/'),
      lab('gone-lab', 'https://gone.example.edu/'),
    ]);
    expect(emitted.map((obs) => obs.entityKey)).toEqual(['beta-lab']);
  });

  it('refuses a quote that three or more rows share, because it is a program page', async () => {
    const shared = 'Undergraduates at Yale are welcome to apply to the departmental assistantship.';
    const pages: Record<string, string> = {};
    const labs = ['one', 'two', 'three'].map((name) => {
      const url = `https://${name}.example.edu/`;
      pages[url] = html(shared);
      return lab(`${name}-faculty`, url);
    });
    pages['https://own.example.edu/'] = html('We welcome undergraduate students to join our lab.');
    labs.push(lab('own-lab', 'https://own.example.edu/'));
    const { emitted, result } = await run(pages, labs);
    expect(emitted.map((obs) => obs.entityKey)).toEqual(['own-lab']);
    expect(result.notes).toContain('3 refused as a quote shared');
  });

  it('keeps the stronger invitation across the home and join pages', async () => {
    const { emitted } = await run(
      {
        'https://gamma.example.edu/': html(
          'We welcome undergraduate students to join our lab.',
          '<a href="/opportunities">Opportunities</a>',
        ),
        'https://gamma.example.edu/opportunities': html(
          'Undergraduate research positions are available this spring.',
        ),
      },
      [lab('gamma-lab', 'https://gamma.example.edu/')],
    );
    expect(emitted[0].value).toMatchObject({
      level: 'actively_hiring',
      sourceUrl: 'https://gamma.example.edu/opportunities',
    });
  });
});
