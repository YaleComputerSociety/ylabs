import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ssrfGuardMock = vi.hoisted(() => {
  const agents = {
    httpAgent: { name: 'ssrf-safe-http-agent' },
    httpsAgent: { name: 'ssrf-safe-https-agent' },
  };
  return {
    agents,
    assertPublicHttpUrl: vi.fn(async (url: string) => new URL(url)),
    ssrfSafeAgents: vi.fn(() => agents),
  };
});

vi.mock('../../utils/ssrfGuard', () => ({
  assertPublicHttpUrl: ssrfGuardMock.assertPublicHttpUrl,
  ssrfSafeAgents: ssrfGuardMock.ssrfSafeAgents,
}));

import {
  assertOfficialProfilePublicationPointerRepairApplyAllowed,
  createRepairPageReader,
  extractFeaturedPublicationsFromHtml,
  extractPublicationListUrlsFromHtml,
  fetchHtmlForRepair,
  findFeaturedPublicationByTitle,
  isGenericPublicationPointerTitle,
  parseOfficialProfilePublicationPointerRepairArgs,
  writeOfficialProfilePublicationPointerRepairOutput,
} from '../repairOfficialProfilePublicationPointers';

describe('repairOfficialProfilePublicationPointers helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    ssrfGuardMock.assertPublicHttpUrl.mockClear();
    ssrfGuardMock.ssrfSafeAgents.mockClear();
  });

  it('identifies generic official-profile publication pointer titles', () => {
    expect(isGenericPublicationPointerTitle('For a complete list, visit my website')).toBe(true);
    expect(isGenericPublicationPointerTitle('See my webpage for selected publications')).toBe(true);
    expect(isGenericPublicationPointerTitle('Google Scholar link')).toBe(true);
    expect(
      isGenericPublicationPointerTitle(
        'Fiduciary AI for the Future of Brain-Technology Interactions',
      ),
    ).toBe(false);
  });

  it('extracts featured publications from loose faculty-site publication markup', () => {
    const html = `
      <html><body>
        <font color="blue"><strong>Selected Publications</strong></font>
        <br><br>
        <li>
          <div>
            <a class="btn" href="/papers/fiduciary-ai.pdf">PDF</a>
            <div class="p-desc"><b>Fiduciary AI for the Future of Brain-Technology Interactions</b><br>Embedding fiduciary duties directly into BCI models</div>
          </div>
        </li>
        <li>
          <div>
            <a class="btn" href="/papers/scalable-far-memory.pdf">PDF</a>
            <div class="p-desc"><b>Scalable Far Memory: Balancing Faults and Evictions, SOSP'25</b><br>Optimizations to improve scaling</div>
          </div>
        </li>
        <h2>Textbooks</h2>
        <li><b>Architectural and Operating System Support for Virtual Memory</b></li>
      </body></html>
    `;

    expect(extractFeaturedPublicationsFromHtml(html, 'https://www.cs.yale.edu/homes/abhishek/')).toEqual([
      {
        title: 'Fiduciary AI for the Future of Brain-Technology Interactions',
        url: 'https://www.cs.yale.edu/papers/fiduciary-ai.pdf',
      },
      {
        title: "Scalable Far Memory: Balancing Faults and Evictions, SOSP'25",
        url: 'https://www.cs.yale.edu/papers/scalable-far-memory.pdf',
      },
    ]);
  });

  it('extracts featured publications from conventional publication lists', () => {
    const html = `
      <html><body>
        <h2>Publications</h2>
        <ul>
          <li><a href="/paper/a">A Useful Publication Title</a>, Journal of Examples, 2025.</li>
          <li><em>Another Useful Publication</em>. Conference on Examples, 2024.</li>
        </ul>
      </body></html>
    `;

    expect(extractFeaturedPublicationsFromHtml(html, 'https://example.test/profile')).toEqual([
      {
        title: 'A Useful Publication Title',
        url: 'https://example.test/paper/a',
      },
    ]);
  });

  it('does not invent paper destinations for unlinked citation-style publication paragraphs', () => {
    const html = `
      <html><body>
        <h2>Publications</h2>
        <p>Ben Fisch, Arthur Lazzaretti, Zeyu Liu, Lei Yang. Permissionless Verifiable Information Dispersal (Data Availability for Bitcoin Rollups). To appear in IEEE Security and Privacy, 2025.</p>
        <p>B. Fisch. Tight Proofs of Space and Replication. Eurocrypt 2019.</p>
      </body></html>
    `;

    expect(extractFeaturedPublicationsFromHtml(html, 'https://sites.google.com/site/benafisch/research')).toEqual([]);
  });

  it('matches a generated official-profile pointer title to a real faculty-site paper link', () => {
    const html = `
      <html><body>
        <h1>Conferences</h1>
        <p>
          Abouzeid, A., D. Angluin, C. Papadimitriou, J. Hellerstein, and A. Silberschatz,
          <a href="C-6-2013.pdf">Learning and Verifying Quantified Boolean Queries by Example</a>,
          <i>ACM SIGACT-SIGMOD Symposium on Principles of Database Systems</i>, June 2013.
        </p>
      </body></html>
    `;
    const publications = extractFeaturedPublicationsFromHtml(
      html,
      'https://codex.cs.yale.edu/avi/home-page/publication-dir/Conferences/conferences.html',
    );

    expect(
      findFeaturedPublicationByTitle(
        publications,
        'Learning and Verifying Quantified Boolean Queries by Example',
      ),
    ).toEqual({
      title: 'Learning and Verifying Quantified Boolean Queries by Example',
      url:
        'https://codex.cs.yale.edu/avi/home-page/publication-dir/Conferences/C-6-2013.pdf',
    });
  });

  it('finds nested publication-list pages from faculty websites and publication indexes', () => {
    const homepageHtml = `
      <html><body>
        His <a href="home-page/publication-dir/publication.html">writings</a> have appeared in ACM and IEEE publications.
      </body></html>
    `;
    const indexHtml = `
      <html><body>
        <h1>Recent Publications</h1>
        <a href="Conferences/conferences.html">Conferences</a>
      </body></html>
    `;

    expect(extractPublicationListUrlsFromHtml(homepageHtml, 'https://codex.cs.yale.edu/avi/')).toEqual([
      'https://codex.cs.yale.edu/avi/home-page/publication-dir/publication.html',
    ]);
    expect(
      extractPublicationListUrlsFromHtml(
        indexHtml,
        'https://codex.cs.yale.edu/avi/home-page/publication-dir/publication.html',
      ),
    ).toEqual([
      'https://codex.cs.yale.edu/avi/home-page/publication-dir/Conferences/conferences.html',
    ]);
  });

  it('reuses fetched faculty publication pages across extraction passes', async () => {
    let fetchCount = 0;
    const htmlByUrl: Record<string, string> = {
      'https://faculty.example.test/publications.html': `
        <html><body>
          <h1>Publications</h1>
          <a href="conferences.html">Conferences</a>
          <p><a href="paper.pdf">A Useful Publication Title</a>, 2026.</p>
        </body></html>
      `,
    };
    const reader = createRepairPageReader(async (url) => {
      fetchCount += 1;
      return htmlByUrl[url] || '';
    });

    await reader.featuredPublications('https://faculty.example.test/publications.html', 10);
    await reader.publicationListUrls('https://faculty.example.test/publications.html');
    await reader.featuredPublications('https://faculty.example.test/publications.html', 500);

    expect(fetchCount).toBe(1);
  });

  it('uses the shared SSRF-safe agents without bypassing TLS verification', async () => {
    const certError = Object.assign(new Error('unable to verify certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const get = vi.spyOn(axios, 'get').mockRejectedValueOnce(certError);

    await expect(fetchHtmlForRepair('https://faculty.yale.edu/publications')).rejects.toBe(
      certError,
    );
    expect(ssrfGuardMock.assertPublicHttpUrl).toHaveBeenCalledWith(
      'https://faculty.yale.edu/publications',
    );
    expect(ssrfGuardMock.ssrfSafeAgents).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[0]).toBe('https://faculty.yale.edu/publications');
    expect(get.mock.calls[0]?.[1]).toMatchObject({
      httpAgent: ssrfGuardMock.agents.httpAgent,
      httpsAgent: ssrfGuardMock.agents.httpsAgent,
    });
    expect(JSON.stringify(get.mock.calls[0]?.[1])).not.toContain('rejectUnauthorized');
  });

  it('parses dry-run and apply options', () => {
    expect(
      parseOfficialProfilePublicationPointerRepairArgs([
        '--apply',
        '--confirm-official-profile-publication-repair',
        '--limit=12',
        '--max-publications-per-pointer=3',
        '--output=/tmp/repair.json',
      ]),
    ).toEqual({
      apply: true,
      confirmOfficialProfilePublicationRepair: true,
      limit: 12,
      limitExplicit: true,
      maxPublicationsPerPointer: 3,
      output: '/tmp/repair.json',
    });
  });

  it('rejects non-literal numeric options before repair planning', () => {
    expect(() => parseOfficialProfilePublicationPointerRepairArgs(['--limit=1e3'])).toThrow(
      /--limit must be a non-negative integer/,
    );
    expect(() =>
      parseOfficialProfilePublicationPointerRepairArgs([
        '--max-publications-per-pointer=1e3',
      ]),
    ).toThrow(/--max-publications-per-pointer must be a non-negative integer/);
  });

  it('requires explicit confirmation for apply mode', () => {
    const options = parseOfficialProfilePublicationPointerRepairArgs(['--apply']);
    expect(() =>
      assertOfficialProfilePublicationPointerRepairApplyAllowed(
        options,
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Beta',
      ),
    ).toThrow(/--confirm-official-profile-publication-repair is required/);
  });

  it('requires an explicit limit before apply mode can run', () => {
    const options = parseOfficialProfilePublicationPointerRepairArgs([
      '--apply',
      '--confirm-official-profile-publication-repair',
    ]);

    expect(() =>
      assertOfficialProfilePublicationPointerRepairApplyAllowed(
        options,
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Beta',
      ),
    ).toThrow(/--limit is required/);
  });

  it('writes repair output when requested', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-pointer-repair-'));
    const output = path.join(dir, 'report.json');
    const payload = { counts: { pointerRows: 1, repairableRows: 1 } };

    writeOfficialProfilePublicationPointerRepairOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual(payload);
  });

  it('rejects unsafe official-profile publication pointer output paths', () => {
    expect(() =>
      parseOfficialProfilePublicationPointerRepairArgs(['--output=/etc/ylabs-report.json']),
    ).toThrow(/must write under/);
    expect(() =>
      writeOfficialProfilePublicationPointerRepairOutput({ mode: 'dry-run' }, '/etc/ylabs-report.json'),
    ).toThrow(/must write under/);
  });
});
